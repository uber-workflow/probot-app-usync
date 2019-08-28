/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const get = require('just-safe-get');
const pick = require('just-pick');
const {GitHubAPI, ProbotOctokit} = require('probot/lib/github');
const {USync} = require('usyncit');
const lang = require('./lang.js');
const OctokitAuthPlugin = require('./OctokitAuthPlugin.js');
const ProbotCommands = require('./ProbotCommands.js');

const {USYNC_PARENT_REPO} = process.env;
// same as probot's `context.github` instance, but specially
// authorized via the custom plugin
const github = new GitHubAPI({
  Octokit: ProbotOctokit.plugin([OctokitAuthPlugin]),
});

/**
 * @typedef {import('@octokit/rest').PullsCreateResponse} PullsCreateResponse
 *
 * @typedef {{
 *   github: *,
 *   payload: import('@octokit/webhooks').WebhookPayloadIssueComment,
 * }} ProbotContextType
 *
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PullRequestOpt
 */

/**
 * @param {ProbotContextType} context
 * @returns {Promise<PullRequestOpt & {
 *   author: {
 *     login: string,
 *   },
 *   baseRefName: string,
 *   body: string,
 *   headRefName: string,
 *   headRepository: {
 *     nameWithOwner: string,
 *   },
 *   mergeable: 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN',
 *   reviews: {
 *     nodes: {
 *       state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING',
 *     }[],
 *   },
 *   state: 'CLOSED' | 'MERGED' | 'OPEN',
 *   title: string,
 *   url: string,
 * }>}
 */
async function getPullRequestInfo({payload}) {
  return github
    .graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            author {
              login
            }
            baseRefName
            body
            headRefName
            headRepository {
              nameWithOwner
            }
            mergeable
            number
            reviews(first: 10) {
              nodes {
                state
              }
            }
            state
            title
            url
          }
        }
      }`,
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        number: payload.issue.number,
      },
    )
    .then(res => ({
      ...get(res, 'repository.pullRequest'),
      repoName: payload.repository.full_name,
    }));
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} body
 * @returns {Promise<*>}
 */
async function addComment(pullRequest, body) {
  return github.request('POST /repos/:repoName/issues/:number/comments', {
    ...pick(pullRequest, ['repoName', 'number']),
    data: {body},
  });
}

/**
 * @param {PullRequestOpt} issue
 * @param {string} label
 * @returns {Promise<*>}
 */
async function addLabel(issue, label) {
  const {repoName} = issue;
  const repoHasLabel = await github
    .request('GET /repos/:repoName/labels', {repoName})
    .then(({data: labels}) =>
      labels.find(repoLabel => repoLabel.name === label),
    );

  if (!repoHasLabel) {
    await github.request('POST /repos/:repoName/labels', {
      repoName,
      data: {
        color: 'ededed',
        name: label,
      },
    });
  }

  return github.request('POST /repos/:repoName/issues/:number/labels', {
    ...pick(issue, ['repoName', 'number']),
    data: {
      labels: [label],
    },
  });
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} label
 * @returns {Promise<Boolean>}
 */
async function prHasLabel(pullRequest, label) {
  const {number, repoName} = pullRequest;
  const [owner, repo] = repoName.split('/');

  return github
    .graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            labels(first: 20) {
              nodes { name }
            }
          }
        }
      }`,
      {owner, repo, number},
    )
    .then(res =>
      (get(res, 'repository.pullRequest.labels.nodes') || [])
        .map(prLabel => prLabel.name)
        .includes(label),
    );
}

/**
 * @param {PullRequestOpt} issue
 * @returns {Promise<*>}
 */
async function closeIssue(issue) {
  return github.request('PATCH /repos/:repoName/pulls/:number', {
    ...pick(issue, ['repoName', 'number']),
    data: {
      state: 'closed',
    },
  });
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} branchName
 * @returns {Promise<*>}
 */
async function deleteBranch(pullRequest, branchName) {
  return github.request('DELETE /repos/:repoName/git/refs/heads/:branchName', {
    repoName: pullRequest.repoName,
    branchName,
  });
}

/**
 * @param {{
 *   data: {
 *     base: string,
 *     head: string,
 *     title: string,
 *     body: string,
 *     draft?: boolean,
 *     maintainer_can_modify?: boolean,
 *   },
 *   repoName: string,
 *   withLabels?: string[],
 * }} opts
 * @returns {Promise<PullsCreateResponse>}
 */
async function createPullRequest(opts) {
  const {repoName, data, withLabels} = opts;

  if (withLabels && withLabels.length) {
    const issue = await github
      .request('POST /repos/:repoName/issues', {
        repoName,
        data: pick(data, ['body', 'title']),
      })
      .then(res => res.data);

    for (const label of withLabels) {
      await addLabel({number: issue.number, repoName}, label);
    }

    return github
      .request('POST /repos/:repoName/pulls', {
        repoName,
        data: {
          issue: issue.number,
          ...pick(data, ['base', 'head']),
        },
      })
      .then(res => res.data);
  } else {
    return github
      .request('POST /repos/:repoName/pulls', {
        repoName,
        data,
      })
      .then(res => res.data);
  }
}

/**
 * @param {ProbotContextType} context
 * @returns {(PullRequestOpt & {
 *   title: string,
 *   url: string,
 * }) | void}
 */
async function findOpenReleasePR({payload}) {
  return github
    .graphql(
      `query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: 100, states: [OPEN]) {
            nodes {
              number
              title
              url
            }
          }
        }
      }`,
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
      },
    )
    .then(res => {
      const releasePR = (get(res, 'repository.pullRequests.nodes') || []).find(
        pullRequest => pullRequest.title.startsWith('Release '),
      );

      if (releasePR) {
        return {
          ...releasePR,
          repoName: payload.repository.full_name,
        };
      }
    });
}

/**
 * @param {string} repoName
 * @param {string} filepath
 * @returns {string} raw text content
 */
async function getFileContent(repoName, filepath) {
  const content = await github
    .request('GET /repos/:repoName/contents/:filepath', {
      repoName,
      filepath,
    })
    .then(res => get(res, 'data.content'));

  return content && Buffer.from(content, 'base64').toString('utf-8');
}

/**
 * Trim leading and trailing empty lines from a
 * multi-line string
 *
 * @param {string} input
 * @returns {string}
 */
function trimLines(input) {
  const lines = input.split('\n');
  let firstLine, lastLine;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) {
      firstLine = i;
      break;
    }
  }

  for (let i = lines.length - 1; i > -1; i--) {
    if (lines[i]) {
      lastLine = i;
      break;
    }
  }

  return lines.slice(firstLine, lastLine + 1).join('\n');
}

/**
 * @param {string} body
 * @returns {{
 *   overrides: Object<string, string>,
 *   summary: string,
 * }}
 */
function parsePRBody(body) {
  return (
    body
      .replace(/\r\n|\r|\n/g, '\n')
      // strip html comments
      .replace(/<!--[\s\S]*?(?:-->)/g, '')
      .split(/^(?=## ?.+)/m)
      .reduce((result, section) => {
        const content = trimLines(section.replace(/^## ?.+\n/, ''));

        if (section.startsWith('## Summary')) {
          result.summary = content.replace('*No summary provided*', '').trim();
        } else if (section.startsWith('## Commit message overrides')) {
          result.overrides = content
            .split(/^(?=\*\*[^*]+\*\*)/m)
            .reduce((overrides, section) => {
              const pattern = /^\*\*([^*]+)\*\*\n```.*\n((?!```)[\s\S]+)\n```/;
              const [, repoName, message] = pattern.exec(section) || [];

              if (repoName && message) {
                overrides[repoName] = message;
              }

              return overrides;
            }, {});
        }

        return result;
      }, {})
  );
}

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

    // require approval if commenter is PR author
    if (payload.comment.user.login === pullRequest.author.login) {
      const hasApproval = pullRequest.reviews.nodes.some(
        review => review.state === 'APPROVED',
      );

      if (!hasApproval) {
        return addComment(pullRequest, lang.error_approval(commandName));
      }
    }

    try {
      if (command === '!import') {
        if (payload.repository.full_name === USYNC_PARENT_REPO) {
          return addComment(pullRequest, lang.error_noImportFromParent());
        }

        const newBranch = [
          'imports',
          pullRequest.headRepository.nameWithOwner,
          payload.issue.number,
        ].join('/');
        let prTemplate;

        try {
          const filepath =
            process.env.BETA === 'true'
              ? '.github/PULL_REQUEST_TEMPLATE/beta.md'
              : '.github/pull_request_template.md';

          prTemplate = await getFileContent(USYNC_PARENT_REPO, filepath);
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

        const hasDisableSyncLabel = await prHasLabel(
          pullRequest,
          'disable-sync',
        );

        const newPR = await createPullRequest({
          repoName: USYNC_PARENT_REPO,
          // FIXME: this is temporary until the old repo sync
          // mechanism is shut down
          withLabels: hasDisableSyncLabel && ['disable-sync'],
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
            await addComment(
              pullRequest,
              lang.notify_landed(landedRepos[pullRequest.repoName].sha),
            );

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
              lang.notify_landed(landedRepos[importedPR.repoName].sha),
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
  trimLines,
};
