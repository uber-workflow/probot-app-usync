/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import pick from 'just-pick';
import keyByProp from 'just-index';
import github from './github.js';
import {base64Decode} from './utils.js';

export const COMMIT_MESSAGE_PREFIX = '[sync] ';
// raw url request
const request = github.request;

/**
 * @typedef {Array<any>} CommitListType
 * @typedef {Array<any>} FilesListType
 * @typedef {Array<any>} TreeType
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
 *   genericMessage: boolean,
 *   repoName: string,
 *   sha: string,
 *   subPath?: string,
 * }} TargetOptType
 */

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
        // TODO: only get the whole tree if needed (not needed for force push)
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
// only exported for tests
export function getCopiedCommitTree(opts) {
  const {origCommit, source, target} = opts;

  if (origCommit.commit.message.startsWith(COMMIT_MESSAGE_PREFIX)) {
    return;
  }

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
// TODO: convert to graphql in the future if github adds
// support for deep trees and commit file contents
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
 *   source: SourceOptType,
 *   target: TargetOptType,
 * }} opts
 * @returns {Promise<void>}
 */
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

      if (target.genericMessage) {
        commit.message = 'Copy commit from parent monorepo';
      }

      commit.message = COMMIT_MESSAGE_PREFIX + commit.message;
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
      sha: lastCommitSha,
    },
  });
}
