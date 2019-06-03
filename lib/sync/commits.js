/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import pick from 'just-pick';
import range from 'just-range';
import keyByProp from 'just-index';
import {request} from '../github.js';
import {getChild, getRelation} from '../relationships.js';
import {base64Decode, parallel} from '../utils.js';

/**
 * @typedef {import('@octokit/rest').GitCreateTreeResponse} GitCreateTreeResponse
 * @typedef {import('@octokit/rest').GitCreateTreeParamsTree} GitCreateTreeParamsTree
 * @typedef {import('@octokit/rest').GitCreateTreeResponseTreeItem} GitCreateTreeResponseTreeItem
 * @typedef {import('@octokit/rest').PullsListCommitsResponseItem} PullsListCommitsResponseItem
 * @typedef {import('@octokit/rest').ReposGetCommitResponse} ReposGetCommitResponse
 * @typedef {import('@octokit/rest').ReposGetCommitResponseFilesItem} ReposGetCommitResponseFilesItem
 *
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 */

/**
 * @param {string} message
 * @returns {object}
 */
export function parseCommitMeta(message) {
  const result = {};

  for (const line of message.split('\n')) {
    if (line.startsWith('meta:')) {
      const props = line
        .trim()
        .replace(/^meta:/, '')
        .split(';');

      for (const prop of props) {
        const [key, value] = prop.split(':');
        // default to true if no value
        result[key] = value || true;
      }

      break;
    }
  }

  return result;
}

/**
 * @param {string} message
 * @returns {string}
 */
export function stripCommitMeta(message) {
  return message.replace(/\n\nmeta:[^\n]*/g, '');
}

// gets the first line of commit message and strips trailing
// pull request indicators; e.g.
// - input: 'My title (#000)\n\nsome other content...'
// - output: 'My title'
export function getRawCommitTitle(message) {
  return message.split('\n')[0].replace(/ ?\([^)]+\)$/, '');
}

/**
 * @param {{
 *   commit: {
 *     author: string,
 *     message: string,
 *   },
 *   parentCommitSha?: string,
 *   parentCommitShas?: string[],
 *   repoName: string,
 *   tree: GitCreateTreeParamsTree,
 * }} opts
 * @returns {Promise<{
 *   sha: string,
 *   tree: GitCreateTreeResponseTreeItem[],
 * }>}
 */
async function commitTree(opts) {
  opts.parentCommitShas = opts.parentCommitShas || [opts.parentCommitSha];

  return request('POST /repos/:repoName/git/trees', {
    repoName: opts.repoName,
    data: {
      tree: opts.tree,
    },
  })
    .then(res =>
      Promise.all([
        // has to re-request new tree since POST response isn't recursive
        request('GET /repos/:repoName/git/trees/:treeSha', {
          recursive: 1,
          repoName: opts.repoName,
          treeSha: res.data.sha,
        }),
        request('POST /repos/:repoName/git/commits', {
          repoName: opts.repoName,
          data: {
            author: opts.commit.author,
            message: opts.commit.message,
            tree: res.data.sha,
            parents: opts.parentCommitShas,
          },
        }),
      ]),
    )
    .then(([treeRes, commitRes]) => ({
      tree: treeRes.data.tree,
      sha: commitRes.data.sha,
    }));
}

/**
 * @param {{
 *   commitInfo: AugmentedCommitInfo,
 *   parentTree: GitCreateTreeResponseTreeItem[],
 *   source: CopySource,
 *   target: CopyTarget,
 * }} opts
 * @returns {Promise<GitCreateTreeParamsTree | void>}
 */
export function copyCommitTree(opts) {
  const {commitInfo, source, target} = opts;

  if (source.subPath) {
    const commitHasTargetFiles = commitInfo.files.some(file =>
      (file.previous_filename || file.filename).startsWith(
        `${source.subPath}/`,
      ),
    );

    if (!commitHasTargetFiles) return;
  }

  const {commit} = commitInfo;
  const commitTreeByPath = keyByProp(commit.tree.tree, 'path');
  const newTreeByPath = keyByProp(
    opts.parentTree
      .filter(file => file.type !== 'tree')
      .map(file => pick(file, ['mode', 'path', 'sha', 'type'])),
    'path',
  );

  // TODO: handle non-file-types (e.g. submodule pointer)
  for (const file of commitInfo.files) {
    const origFilename = file.previous_filename || file.filename;
    // this is only different than `origFilename` if the file
    // was renamed
    const newFilename = file.filename;
    // these represent what each filename is in the target repo
    let targetOrigFilename = origFilename;
    let targetNewFilename = newFilename;

    if (source.subPath) {
      if (!origFilename.startsWith(`${source.subPath}/`)) {
        // don't handle files outside of subPath
        continue;
      }

      // strip subPath
      targetOrigFilename = origFilename.slice(source.subPath.length + 1);
      targetNewFilename = newFilename.slice(source.subPath.length + 1);
    }

    if (target.subPath) {
      // prepend subPath
      targetOrigFilename = `${target.subPath}/${origFilename}`;
      targetNewFilename = `${target.subPath}/${newFilename}`;
    }

    if (file.status === 'removed') {
      delete newTreeByPath[targetOrigFilename];
      continue;
    }

    const treeFile = pick(commitTreeByPath[newFilename], [
      'mode',
      'path',
      'type',
    ]);

    newTreeByPath[targetOrigFilename] = {
      ...treeFile,
      content: base64Decode(file.content),
      path: targetNewFilename,
    };
  }

  return Object.values(newTreeByPath);
}

/**
 * @typedef {ReposGetCommitResponse & {
 *   commit: {
 *     tree: GitCreateTreeResponse,
 *   },
 *   files: ReposGetCommitResponseFilesItem & {
 *     content: string,
 *   }[],
 * }} AugmentedCommitInfo
 *
 * @typedef {PRCommitProps & {
 *   _: AugmentedCommitInfo,
 * }} AugmentedPRCommit
 */
/**
 * Fetches full commit tree, commit files & content as
 * needed
 * @param {CopySource} copySource
 * @returns {Promise<AugmentedPRCommit[]>}
 */
async function augmentPRCommits(copySource) {
  const {commits, repoName} = copySource;

  return Promise.all(
    commits.map(async prCommit => {
      let commitInfo = prCommit._;

      if (!commitInfo.files) {
        // fetch full commit data (which includes `files` property)
        commitInfo = prCommit._ = await request(
          'GET /repos/:repoName/commits/:sha',
          {
            repoName,
            sha: commitInfo.sha,
          },
        ).then(res => res.data);
      }

      await parallel([
        async () => {
          const {commit} = commitInfo;

          if (!commit.tree.tree) {
            commit.tree = await request(
              'GET /repos/:repoName/git/trees/:treeSha',
              {
                repoName,
                treeSha: commit.tree.sha,
                recursive: 1,
              },
            ).then(res => res.data);
          }
        },
        async () => {
          commitInfo.files = await Promise.all(
            commitInfo.files.map(async file => {
              if (file.status !== 'removed') {
                file.content = await request(
                  'GET /repos/:repoName/contents/:filepath',
                  {
                    filepath: file.filename,
                    ref: commitInfo.sha,
                    repoName,
                  },
                ).then(res => res.data.content);
              }

              return file;
            }),
          );
        },
      ]);

      return prCommit;
    }),
  );
}

/**
 * @param {{
 *   commitSha: string,
 *   partnerBranch: string,
 *   partnerRepoName: string,
 *   repoName: string,
 * }} opts
 * @returns {Promise<string>}
 */
async function getPartnerCommitSha(opts) {
  const {commitSha, partnerBranch, partnerRepoName, repoName} = opts;
  const commit = await request('GET /repos/:repoName/commits/:commitSha', {
    commitSha,
    repoName,
  }).then(res => res.data);
  const commitMessage = commit.commit.message;
  const commitMeta = parseCommitMeta(commitMessage);

  if (commitMeta.sha) {
    const partnerCommit = await request(
      'GET /repos/:repoName/commits/:commitSha',
      {
        commitSha: commitMeta.sha,
        repoName: partnerRepoName,
      },
    ).then(res => res.data);

    if (
      getRawCommitTitle(commitMessage) ===
      getRawCommitTitle(partnerCommit.commit.message)
    ) {
      return partnerCommit.sha;
    }
  }

  let partnerCommitSha = await request(
    'GET /repos/:repoName/git/refs/heads/:branchName',
    {
      repoName: partnerRepoName,
      branchName: partnerBranch,
    },
  ).then(res => get(res, 'data.object.sha'));

  if (partnerCommitSha) {
    // search in last 10 commits of partner branch
    for (const index in range(9)) {
      const partnerCommit = await request(
        'GET /repos/:repoName/commits/:commitSha',
        {
          commitSha: partnerCommitSha,
          repoName: partnerRepoName,
        },
      ).then(res => res.data);
      const partnerCommitMeta = parseCommitMeta(partnerCommit.commit.message);

      if (partnerCommitMeta && partnerCommitMeta.sha === commitSha) {
        return partnerCommitSha;
      } else if (
        getRawCommitTitle(commitMessage) ===
        getRawCommitTitle(partnerCommit.commit.message)
      ) {
        return partnerCommitSha;
      }

      if (index < 8 && partnerCommit.parents.length === 1) {
        partnerCommitSha = partnerCommit.parents[0].sha;
      } else {
        break;
      }
    }
  }
}

/**
 * @typedef {{
 *   commits: PRCommit[],
 *   repoName: string,
 *   branch?: string,
 *   subPath?: string,
 * }} CopySource
 *
 * @typedef {{
 *   branch: string,
 *   commitSha: string,
 *   commitTreeSha: string,
 *   repoName: string,
 *   baseBranch?: string,
 *   subPath?: string,
 * }} CopyTarget
 */
/**
 * @param {{
 *   source: CopySource,
 *   target: CopyTarget,
 *   forcePush?: boolean,
 *   includeTraceSha?: boolean,
 *   preserveCommitDate?: boolean,
 *   stripMeta?: boolean,
 * }} opts
 * @returns {Promise<void>}
 */
export async function copyCommits(opts) {
  const {source, target} = opts;
  const [sourceCommits, targetCommitTree] = await Promise.all([
    augmentPRCommits(source),
    request('GET /repos/:repoName/git/trees/:treeSha', {
      repoName: target.repoName,
      treeSha: target.commitTreeSha,
      recursive: 1,
    }).then(res => res.data.tree),
  ]);
  let parentCommitSha = target.commitSha;
  let parentTree = targetCommitTree;

  for (const prCommit of sourceCommits) {
    const parentCommitShas = [parentCommitSha];
    const commitInfo = prCommit._;
    const newTree = copyCommitTree({
      commitInfo,
      parentTree,
      source,
      target,
    });

    if (newTree) {
      const commit = commitInfo.commit;

      // attempt to handle merge commit
      if (commitInfo.parents.length === 2) {
        if (!target.baseBranch) {
          throw new Error(
            `'target.baseBranch' option required to copy merge commit: ${
              commitInfo.sha
            }`,
          );
        }

        const partnerParentSha = await getPartnerCommitSha({
          commitSha: commitInfo.parents[1].sha,
          partnerBranch: target.baseBranch,
          partnerRepoName: target.repoName,
          repoName: source.repoName,
        });

        if (partnerParentSha) {
          parentCommitShas.push(partnerParentSha);
        }

        if (source.branch && commit.message.includes(source.branch)) {
          commit.message = commit.message.replace(source.branch, target.branch);
        }
      }

      if (!opts.preserveCommitDate) {
        commit.author.date = new Date().toISOString();
      }

      if (prCommit.shouldUseGenericMessage) {
        commit.message = 'Copy commit from parent repo';
      }

      if (opts.stripMeta) {
        commit.message = stripCommitMeta(commit.message);
      }

      if (opts.includeTraceSha) {
        commit.message += `\n\nmeta:sha:${commitInfo.sha}`;
      }

      const {sha, tree} = await commitTree({
        commit,
        parentCommitShas,
        repoName: target.repoName,
        tree: newTree,
      });

      parentCommitSha = sha;
      parentTree = tree;
    }
  }

  return request('PATCH /repos/:repoName/git/refs/heads/:branchName', {
    branchName: target.branch,
    repoName: target.repoName,
    data: {
      force: opts.forcePush || false,
      sha: parentCommitSha,
    },
  });
}

/**
 * @typedef {{
 *   message: string,
 *   sha: string,
 *   shouldSync: boolean,
 *   shouldUseGenericMessage: boolean,
 * }} PRCommitProps
 *
 * @typedef {PRCommitProps & {
 *   _: PullsListCommitsResponseItem | ReposGetCommitResponse,
 * }} PRCommit
 */
/**
 * @param {PROptType} pullRequest
 * @param {string} [subPath]
 * @returns {Promise<PRCommit[]>}
 */
export async function getPRCommitList(pullRequest, subPath) {
  return request(
    'GET /repos/:repoName/pulls/:number/commits',
    pullRequest,
  ).then(res => {
    const commits = (res.data || []).map(commit => ({
      _: commit,
      message: commit.commit.message,
      sha: commit.sha,
      shouldSync: true,
      shouldUseGenericMessage: false,
    }));

    if (commits.length && subPath) {
      return Promise.all(
        commits.map(async commit => {
          const fullCommit = await request(
            'GET /repos/:repoName/commits/:sha',
            {
              repoName: pullRequest.repoName,
              sha: commit.sha,
            },
          ).then(res => res.data);
          const {files} = fullCommit;

          // save the full commit so we don't have to re-request later
          commit._ = fullCommit;

          if (files.length) {
            let modifiesFilesAboveSubPath, modifiesFilesInSubPath;

            for (const file of files) {
              if (file.filename.startsWith(subPath)) {
                modifiesFilesInSubPath = true;
              } else {
                modifiesFilesAboveSubPath = true;
              }

              if (modifiesFilesAboveSubPath && modifiesFilesInSubPath) break;
            }

            commit.shouldSync = modifiesFilesInSubPath;
            commit.shouldUseGenericMessage =
              modifiesFilesInSubPath && modifiesFilesAboveSubPath;
          }

          return commit;
        }),
      );
    }

    return commits;
  });
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<[PRCommit[], PRCommit[]]>} [primaryPRCommits, secondaryPRCommits]
 */
async function getCommitLists(primaryPR, secondaryPR) {
  const primaryRepoName = primaryPR.repoName;
  const secondaryRepoName = secondaryPR.repoName;
  let primarySubPath, secondarySubPath;

  if (getRelation(primaryRepoName, secondaryRepoName) === 'parent') {
    primarySubPath = getChild(primaryRepoName, secondaryRepoName).path;
  } else {
    secondarySubPath = getChild(secondaryRepoName, primaryRepoName).path;
  }

  return Promise.all([
    getPRCommitList(primaryPR, primarySubPath),
    getPRCommitList(secondaryPR, secondarySubPath),
  ]);
}

/**
 * @typedef {{
 *   copySource: 'primary' | 'secondary' | void,
 *   hasConflict: boolean,
 *   hasMismatch: boolean,
 *   lastCommonPrimaryIndex: number | void,
 *   lastCommonSecondaryIndex: number | void,
 * }} PRCommitsState
 */
/**
 * @param {PRCommit[]} primaryCommits
 * @param {PRCommit[]} secondaryCommits
 * @returns {Promise<PRCommitsState>}
 */
export function getCommitsState(primaryCommits, secondaryCommits) {
  let pIndex = 0;
  let sIndex = 0;
  let hasConflict = false;
  let hasMismatch = false;
  let copySource, lastCommonPrimaryIndex, lastCommonSecondaryIndex;

  while (pIndex < primaryCommits.length || sIndex < secondaryCommits.length) {
    const primaryCommit = primaryCommits[pIndex];
    const secondaryCommit = secondaryCommits[sIndex];

    if (primaryCommit && !primaryCommit.shouldSync) {
      pIndex++;
      continue;
    } else if (secondaryCommit && !secondaryCommit.shouldSync) {
      sIndex++;
      continue;
    }

    if (primaryCommit && secondaryCommit) {
      const primaryMeta = parseCommitMeta(primaryCommit.message) || {};
      const secondaryMeta = parseCommitMeta(secondaryCommit.message) || {};

      if (
        (!primaryMeta.sha && !secondaryMeta.sha) ||
        (primaryMeta.sha !== secondaryCommit.sha &&
          secondaryMeta.sha !== primaryCommit.sha)
      ) {
        hasMismatch = true;
        hasConflict = true;
        // in the event of a conflict, use primary pr as source of truth
        copySource = 'primary';
      } else {
        // happy path (commits match)
        lastCommonPrimaryIndex = pIndex;
        lastCommonSecondaryIndex = sIndex;
      }
    } else if (primaryCommit && !secondaryCommit) {
      hasMismatch = true;
      copySource = 'primary';
    } else if (!primaryCommit && secondaryCommit) {
      hasMismatch = true;
      copySource = 'secondary';
    }

    if (hasMismatch) {
      break;
    } else {
      pIndex++;
      sIndex++;
    }
  }

  return {
    copySource,
    hasConflict,
    hasMismatch,
    lastCommonPrimaryIndex,
    lastCommonSecondaryIndex,
  };
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<void>}
 */
export async function syncCommits(primaryPR, secondaryPR) {
  const [primaryCommits, secondaryCommits] = await getCommitLists(
    primaryPR,
    secondaryPR,
  );
  const state = getCommitsState(primaryCommits, secondaryCommits);

  if (state.hasMismatch) {
    const primaryIsSource = state.copySource === 'primary';
    const lastCommonSourceIndex = primaryIsSource
      ? state.lastCommonPrimaryIndex
      : state.lastCommonSecondaryIndex;
    const lastCommonTargetIndex = primaryIsSource
      ? state.lastCommonSecondaryIndex
      : state.lastCommonPrimaryIndex;
    const sourceCommits = primaryIsSource ? primaryCommits : secondaryCommits;
    const targetCommits = primaryIsSource ? secondaryCommits : primaryCommits;
    const [sourcePRInfo, targetPRInfo] = await Promise.all([
      request(
        'GET /repos/:repoName/pulls/:number',
        primaryIsSource ? primaryPR : secondaryPR,
      ).then(res => res.data),
      request(
        'GET /repos/:repoName/pulls/:number',
        primaryIsSource ? secondaryPR : primaryPR,
      ).then(res => res.data),
    ]);
    // repo names aren't referenced from original args in case of a fork,
    // which would have a different repo name
    const sourceRepoName = sourcePRInfo.head.repo.full_name;
    const targetRepoName = targetPRInfo.head.repo.full_name;
    const sourceBaseRepoName = primaryIsSource
      ? primaryPR.repoName
      : secondaryPR.repoName;
    const targetBaseRepoName = primaryIsSource
      ? secondaryPR.repoName
      : primaryPR.repoName;
    const hasCommonCommit = typeof lastCommonSourceIndex === 'number';

    const targetCommit = hasCommonCommit
      ? targetCommits[lastCommonTargetIndex]
      : targetCommits[0]._.parents[0];
    const copyOpts = {
      forcePush: state.hasConflict,
      includeTraceSha: true,
      stripMeta: true,
      preserveCommitDate: true,
      source: {
        branch: sourcePRInfo.head.ref,
        commits: hasCommonCommit
          ? sourceCommits.slice(lastCommonSourceIndex + 1)
          : sourceCommits,
        repoName: sourceRepoName,
      },
      target: {
        baseBranch: targetPRInfo.base.ref,
        branch: targetPRInfo.head.ref,
        commitSha: targetCommit.sha,
        commitTreeSha: targetCommit._.commit.tree.sha,
        repoName: targetRepoName,
      },
    };

    if (getRelation(sourceBaseRepoName, targetBaseRepoName) === 'parent') {
      copyOpts.source.subPath = getChild(
        sourceBaseRepoName,
        targetBaseRepoName,
      ).path;
    } else {
      copyOpts.target.subPath = getChild(
        targetBaseRepoName,
        sourceBaseRepoName,
      ).path;
    }

    await copyCommits(copyOpts);
  }
}
