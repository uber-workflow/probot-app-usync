/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import pick from 'just-pick';
import keyByProp from 'just-index';
import {request} from '../github.js';
import {getPRFromNumber} from '../graphql.js';
import {getChild, getRelation} from '../relationships.js';
import {base64Decode} from '../utils.js';

/**
 * @typedef {Array<any>} CommitListType
 * @typedef {Array<any>} FilesListType
 * @typedef {Array<any>} TreeType
 *
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 *
 * @typedef {{
 *   sha: string,
 *   tree: TreeType,
 * }} TreeSchemaType
 *
 * @typedef {{
 *   afterSha: string,
 *   beforeSha: string,
 *   repoName: string,
 *   subPath?: string,
 * }} SourceOptType
 *
 * @typedef {{
 *   branch: string,
 *   repoName: string,
 *   sha: string,
 *   genericMessage?: boolean,
 *   subPath?: string,
 * }} TargetOptType
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

/**
 * @param {{
 *   commit: {
 *     author: string,
 *     message: string,
 *   },
 *   parentCommitSha: string,
 *   parentTreeSha: string,
 *   repoName: string,
 *   tree: TreeType,
 * }} opts
 * @returns {Promise<{
 *   sha: string,
 *   tree: TreeSchemaType,
 * }>}
 */
async function commitTree(opts) {
  return request('POST /repos/:repoName/git/trees', {
    repoName: opts.repoName,
    data: {
      base_tree: opts.parentTreeSha,
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
            parents: [opts.parentCommitSha],
          },
        }),
      ]),
    )
    .then(([treeRes, commitRes]) => ({
      tree: treeRes.data,
      sha: commitRes.data.sha,
    }));
}

/**
 * @param {{
 *   files: FilesListType,
 *   ref: string,
 *   repoName: string,
 * }} opts
 * @returns {Promise<FilesListType>}
 */
async function populateFilesContent(opts) {
  return Promise.all(
    opts.files.map(async file => {
      if (file.status !== 'removed') {
        file.content = await request(
          'GET /repos/:repoName/contents/:filepath',
          {
            filepath: file.filename,
            ref: opts.ref,
            repoName: opts.repoName,
          },
        ).then(res => res.data.content);
      }

      return file;
    }),
  );
}

/**
 * @param {{
 *   origCommit: any,
 *   parentTree: TreeSchemaType,
 *   source: SourceOptType,
 *   target: TargetOptType,
 * }} opts
 * @returns {Promise<TreeType|void>}
 */
export function getCopiedCommitTree(opts) {
  const {origCommit, source, target} = opts;

  if (source.subPath) {
    const commitHasTargetFiles = origCommit.files.some(file =>
      (file.previous_filename || file.filename).startsWith(
        `${source.subPath}/`,
      ),
    );

    if (!commitHasTargetFiles) return;
  }

  const {commit} = origCommit;
  const commitTreeByPath = keyByProp(commit.tree.tree, 'path');
  const newTreeByPath = keyByProp(
    opts.parentTree.tree
      .filter(file => file.type !== 'tree')
      .map(file => pick(file, ['mode', 'path', 'sha', 'type'])),
    'path',
  );

  // TODO: handle non-file-types (e.g. submodule pointer)
  for (const file of origCommit.files) {
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
 * @param {{
 *   afterSha: string,
 *   beforeSha: string,
 *   repoName: string,
 * }} opts
 * @returns {Promise<CommitListType>}
 */
async function getCommitsInRange(opts) {
  const {repoName} = opts;
  return (
    request('GET /repos/:repoName/compare/:beforeSha...:afterSha', opts)
      .then(res => res.data.commits)
      // add `files`, augment `tree` on each commit
      .then(pushedCommits =>
        Promise.all(
          pushedCommits.map(async pushedCommit => {
            const commitSha = pushedCommit.sha;
            const treeSha = pushedCommit.commit.tree.sha;
            const [files, tree] = await Promise.all([
              request('GET /repos/:repoName/commits/:commitSha', {
                commitSha,
                repoName,
              }).then(res =>
                populateFilesContent({
                  files: res.data.files,
                  ref: commitSha,
                  repoName,
                }),
              ),
              request('GET /repos/:repoName/git/trees/:treeSha', {
                recursive: 1,
                repoName,
                treeSha,
              }).then(res => res.data),
            ]);

            return {
              ...pushedCommit,
              commit: {
                ...pushedCommit.commit,
                tree,
              },
              files,
            };
          }),
        ),
      )
  );
}

/**
 * @param {{
 *   forcePush?: boolean,
 *   includeTraceSha?: boolean,
 *   preserveCommitDate?: boolean,
 *   source: SourceOptType,
 *   stripMeta?: boolean,
 *   target: TargetOptType,
 * }} opts
 * @returns {Promise<void>}
 */
// TODO: use generic message if pr has both parent and child files changed
// - ugly fix could be to pass baseRepoName
// TODO: merge commits
export async function copyCommits(opts) {
  const {source, target} = opts;
  // `parentTree` is a moving reference to the parent tree
  // for the current commit being copied; it's initially the
  // current tree of the target repo
  let [commits, parentTree] = await Promise.all([
    getCommitsInRange({
      repoName: source.repoName,
      beforeSha: source.beforeSha,
      afterSha: source.afterSha,
    }),
    request('GET /repos/:repoName/commits/:commitSha', {
      commitSha: target.sha,
      repoName: target.repoName,
    })
      .then(res =>
        request('GET /repos/:repoName/git/trees/:treeSha', {
          recursive: 1,
          repoName: target.repoName,
          treeSha: res.data.commit.tree.sha,
        }),
      )
      .then(res => res.data),
  ]);
  let lastCommitSha = target.sha;

  for (const origCommit of commits) {
    const newTree = getCopiedCommitTree({
      origCommit,
      parentTree,
      source,
      target,
    });

    if (newTree) {
      const commit = origCommit.commit;

      if (!opts.preserveCommitDate) {
        commit.author.date = new Date().toISOString();
      }

      if (target.genericMessage) {
        commit.message = 'Copy commit from parent monorepo';
      }

      if (opts.stripMeta) {
        commit.message = stripCommitMeta(commit.message);
      }

      if (opts.includeTraceSha) {
        commit.message += `\n\nmeta:sha:${origCommit.sha}`;
      }

      const {sha, tree} = await commitTree({
        commit,
        parentCommitSha: lastCommitSha,
        parentTreeSha: parentTree.sha,
        repoName: target.repoName,
        tree: newTree,
      });

      parentTree = tree;
      lastCommitSha = sha;
    }
  }

  return request('PATCH /repos/:repoName/git/refs/heads/:branchName', {
    branchName: target.branch,
    repoName: target.repoName,
    data: {
      force: opts.forcePush || false,
      sha: lastCommitSha,
    },
  });
}

/**
 * @typedef {{
 *   message: string,
 *   oid: string,
 *   shouldSync: boolean,
 * }} CommitType
 *
 * `commit.shouldSync` is true by default, but if `subDir` arg is
 * provided, looks up files changed in each commit and determines
 * if any files were changed in that dir
 * @param {PROptType} pullRequest
 * @param {string} [subDir]
 * @returns {Promise<CommitType[]>}
 */
async function getPRCommitList(pullRequest, subDir) {
  return getPRFromNumber(
    `
      {
        commits(first: 100) {
          nodes {
            commit {
              message
              oid
            }
          }
        }
      }
    `,
    pullRequest,
    'repository.pullRequest.commits.nodes',
  )
    .then(nodes =>
      (nodes || []).map(node => {
        node.commit.shouldSync = true;
        return node.commit;
      }),
    )
    .then(commits => {
      if (subDir) {
        return Promise.all(
          commits.map(async commit => {
            const res = await request('GET /repos/:repoName/commits/:sha', {
              repoName: pullRequest.repoName,
              sha: commit.oid,
            });

            commit.shouldSync =
              !res.data.files.length ||
              res.data.files.some(file => file.filename.startsWith(subDir));
            return commit;
          }),
        );
      } else {
        return commits;
      }
    });
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<[CommitType[], CommitType[]]>}
 */
async function getCommitLists(primaryPR, secondaryPR) {
  const primaryRepoName = primaryPR.repoName;
  const secondaryRepoName = secondaryPR.repoName;
  let primarySubDir, secondarySubDir;

  if (getRelation(primaryRepoName, secondaryRepoName) === 'parent') {
    primarySubDir = getChild(primaryRepoName, secondaryRepoName).path;
  } else {
    secondarySubDir = getChild(secondaryRepoName, primaryRepoName).path;
  }

  return Promise.all([
    getPRCommitList(primaryPR, primarySubDir),
    getPRCommitList(secondaryPR, secondarySubDir),
  ]);
}

/**
 * @param {CommitType[]} primaryCommits
 * @param {CommitType[]} secondaryCommits
 * @returns {Promise<{
 *   copySource: 'primary' | 'secondary' | void,
 *   hasConflict: boolean,
 *   hasMismatch: boolean,
 *   lastCommonPrimaryIndex: number | void,
 *   lastCommonSecondaryIndex: number | void,
 * }>}
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
        (primaryMeta.sha !== secondaryCommit.oid &&
          secondaryMeta.sha !== primaryCommit.oid)
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
      getPRFromNumber(
        '{baseRefOid, headRefName, headRepository {nameWithOwner}}',
        primaryIsSource ? primaryPR : secondaryPR,
        'repository.pullRequest',
      ),
      getPRFromNumber(
        '{baseRefOid, headRefName, headRepository {nameWithOwner}}',
        primaryIsSource ? secondaryPR : primaryPR,
        'repository.pullRequest',
      ),
    ]);
    // repo names aren't referenced from original args in case of a fork,
    // which would have a different repo name
    const sourceRepoName = sourcePRInfo.headRepository.nameWithOwner;
    const targetRepoName = targetPRInfo.headRepository.nameWithOwner;
    const sourceBaseRepoName = primaryIsSource
      ? primaryPR.repoName
      : secondaryPR.repoName;
    const targetBaseRepoName = primaryIsSource
      ? secondaryPR.repoName
      : primaryPR.repoName;
    const hasCommonCommit = typeof lastCommonSourceIndex === 'number';

    const copyOpts = {
      forcePush: state.hasConflict,
      includeTraceSha: true,
      stripMeta: true,
      preserveCommitDate: true,
      source: {
        afterSha: sourceCommits[sourceCommits.length - 1].oid,
        beforeSha: hasCommonCommit
          ? sourceCommits[lastCommonSourceIndex].oid
          : sourcePRInfo.baseRefOid,
        repoName: sourceRepoName,
      },
      target: {
        branch: targetPRInfo.headRefName,
        repoName: targetRepoName,
        sha: hasCommonCommit
          ? targetCommits[lastCommonTargetIndex].oid
          : targetPRInfo.baseRefOid,
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
