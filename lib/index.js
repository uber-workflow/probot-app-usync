/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {USync} = require('usyncit');
const {
  addComment,
  addLabel,
  closeIssue,
  createPullRequest,
  deleteBranch,
  findOpenReleasePR,
  getFileContent,
  getPullRequestInfo,
  parsePRBody,
  prHasLabel,
} = require('./github.js');
const lang = require('./lang.js');
const ProbotCommands = require('./ProbotCommands.js');

const {USYNC_PARENT_REPO} = process.env;

/**
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PullRequestOpt
 */

/**
 * Parse summary and overrides from pull request body
 * and generate commit messages for the involved
 * repos
 *
 * @param {PullRequestOpt & {
 *   body: string,
 *   title: string,
 * }} pullRequest
 * @param {PullRequestOpt} [importedPR]
 * @returns {{
 *   generic: string,
 * } & Object<string, string>} map of repo names to commit messages
 */
function generateCommitMessages(pullRequest, importedPR) {
  const PRRefs = [pullRequest, importedPR].filter(Boolean);
  const {overrides, summary} = parsePRBody(pullRequest.body);
  const result = {
    generic: pullRequest.title + (summary ? `\n\n${summary}` : ''),
    ...overrides,
  };

  for (const {number, repoName} of PRRefs) {
    result[repoName] = (result[repoName] || result.generic)
      .split('\n')
      .map((line, i) => {
        if (i === 0) {
          line += ` (#${number})\nhttps://github.com/${repoName}/pull/${number}`;
        }
        return line;
      })
      .join('\n');
  }

  return result;
}

/**
 * @param {import('probot').Application} app
 */
function ProbotApp(app) {
  const commands = new ProbotCommands(app);
  const sync = new USync(USYNC_PARENT_REPO);

  commands.on(['!import', '!land'], async (context, command) => {
    const {payload} = context;
    const pullRequest = await getPullRequestInfo(context);
    const commandName = command.slice(1);
    const isFork =
      payload.repository.full_name !== pullRequest.headRepository.nameWithOwner;

    if (pullRequest.state !== 'OPEN') {
      return addComment(pullRequest, lang.error_PRNotOpen(commandName));
    }

    if (pullRequest.baseRefName !== 'master') {
      return addComment(pullRequest, lang.error_targetNotMaster());
    }

    if (pullRequest.mergeable !== 'MERGEABLE') {
      return addComment(
        pullRequest,
        lang.error_branchNotMergeable(commandName),
      );
    }

    // require approval for landing if commenter is PR author
    if (
      command === '!land' &&
      payload.comment.user.login === pullRequest.author.login
    ) {
      const hasApproval = pullRequest.reviews.nodes.some(
        review => review.state === 'APPROVED',
      );

      // https://developer.github.com/v4/enum/mergestatestatus/
      const upToDatePassing =
        pullRequest.mergeStateStatus === 'CLEAN' ||
        pullRequest.mergeStateStatus === 'HAS_HOOKS';

      if (!hasApproval || !upToDatePassing) {
        const hasBreakglass = await prHasLabel(pullRequest, 'breakglass');

        if (!hasBreakglass && !upToDatePassing) {
          return addComment(
            pullRequest,
            lang.error_upToDatePassing(commandName),
          );
        }

        if (!hasBreakglass && !hasApproval) {
          return addComment(pullRequest, lang.error_approval(commandName));
        }
      }
    }

    try {
      if (command === '!import') {
        if (payload.repository.full_name === USYNC_PARENT_REPO) {
          return addComment(pullRequest, lang.error_noImportFromParent());
        }

        const newBranch = [
          'imports',
          pullRequest.repoName,
          payload.issue.number,
        ].join('/');
        let prTemplate;

        try {
          prTemplate = await getFileContent(
            USYNC_PARENT_REPO,
            '.github/pull_request_template.md',
          );
        } catch (e) {
          return addComment(pullRequest, lang.error_noPRTemplate(commandName));
        }

        await sync.import({
          baseRepoName: payload.repository.full_name,
          headRepoName: pullRequest.headRepository.nameWithOwner,
          headBranch: pullRequest.headRefName,
          message: pullRequest.title,
          newBranch,
        });

        const newPR = await createPullRequest({
          repoName: USYNC_PARENT_REPO,
          data: {
            title: pullRequest.title,
            base: 'master',
            head: newBranch,
            body: lang.PRBody_imported({
              importedPR: pullRequest,
              template: prTemplate,
            }),
          },
        });

        await addComment(
          {
            repoName: USYNC_PARENT_REPO,
            number: newPR.number,
          },
          lang.notify_importedToParent({
            importedPR: pullRequest,
            importer: payload.comment.user.login,
          }),
        );
        await closeIssue(pullRequest);
        await addComment(
          pullRequest,
          lang.notify_importedFromChild(newPR.html_url),
        );

        if (!isFork) {
          await deleteBranch(pullRequest, pullRequest.headRefName);
        }
      } else if (command === '!land') {
        if (payload.repository.full_name !== USYNC_PARENT_REPO) {
          return addComment(pullRequest, lang.error_mustLandFromParent());
        }

        const releasePR = await findOpenReleasePR(context);
        let importedPR;

        if (releasePR) {
          return addComment(
            pullRequest,
            lang.error_noLandDuringRelease(releasePR.url),
          );
        }

        if (!isFork && pullRequest.headRefName.startsWith('imports/')) {
          const [, owner, repo, number] = pullRequest.headRefName.split('/');

          importedPR = {
            repoName: `${owner}/${repo}`,
            number: parseInt(number),
          };
        }

        const landedRepos = await sync.land({
          commitMessages: generateCommitMessages(pullRequest, importedPR),
          fallbackBranch: `land/${pullRequest.number}`,
          headRepoName: pullRequest.headRepository.nameWithOwner,
          headBranch: pullRequest.headRefName,
        });

        await Promise.all([
          // update this pull request
          (async () => {
            await closeIssue(pullRequest);
            await addLabel(pullRequest, 'Landed');
            await addComment(pullRequest, lang.notify_landedAll(landedRepos));

            if (!isFork) {
              await deleteBranch(pullRequest, pullRequest.headRefName);
            }
          })(),
          // update originally imported pull request
          (async () => {
            if (!importedPR || !landedRepos[importedPR.repoName]) {
              return;
            }

            await addLabel(importedPR, 'Landed');
            await addComment(
              importedPR,
              lang.notify_landedRepo(landedRepos, importedPR.repoName),
            );
          })(),
        ]);
      }
    } catch (error) {
      await addComment(pullRequest, lang.error_SyncError(commandName, error));
      throw error;
    }
  });
}

module.exports = {
  ProbotApp,
  // exported for tests
  generateCommitMessages,
};
