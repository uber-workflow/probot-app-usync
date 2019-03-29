/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// @flow (technically isn't installed; just have types in this file for doc purposes)

const pick = require('just-pick');
const keyByProp = require('just-index');
const {base64Decode} = require('./utils.js');
const COMMIT_MESSAGE_PREFIX = '[sync] ';

/*::
type FilesType = Array<any>
type TreeType = Array<any>
type TreeSchemaType = {
  sha: string,
  tree: TreeType,
}

type SourceOptType = {
  afterSha: string,
  beforeSha: string,
  repoName: string,
  subPath?: string,
}

type TargetOptType = {
  branch: string,
  genericMessage: boolean,
  repoName: string,
  sha: string,
  subPath?: string,
}
*/

exports.COMMIT_MESSAGE_PREFIX = COMMIT_MESSAGE_PREFIX;
exports.CommitCopier = class CommitCopier {
  constructor(github) {
    this.github = github;
    // raw url request
    this.request = github.request.bind(github);
  }

  async _commitTree(
    opts /*: {
      commit: {
        author: string,
        message: string,
      },
      parentCommitSha: string,
      parentTreeSha: string,
      repoName: string,
      tree: TreeType,
    } */,
  ) /*: Promise<{ sha: string, tree: TreeSchemaType }> */ {
    return this.request('POST /repos/:repoName/git/trees', {
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
          this.request('GET /repos/:repoName/git/trees/:treeSha', {
            recursive: 1,
            repoName: opts.repoName,
            treeSha: res.data.sha,
          }),
          this.request('POST /repos/:repoName/git/commits', {
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

  async _populateFilesContent(
    opts /*: {
      files: FilesType,
      ref: string,
      repoName: string,
    } */,
  ) /*: Promise<FilesType> */ {
    return Promise.all(
      opts.files.map(async file => {
        if (file.status !== 'removed') {
          file.content = await this.request(
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

  _getCopiedCommitTree(
    opts /*: {
      origCommit: any,
      parentTree: TreeSchemaType,
      source: SourceOptType,
      target: TargetOptType,
    } */,
  ) /*: Promise<TreeType | void> */ {
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

  // TODO: convert to graphql in the future if github adds
  // support for deep trees and commit file contents
  async _getCommitsInRange(
    opts /*: {
      afterSha: string,
      beforeSha: string,
      repoName: string,
    } */,
  ) /*: Promise<Array<any>> */ {
    const {repoName} = opts;
    return (
      this.request('GET /repos/:repoName/compare/:beforeSha...:afterSha', opts)
        .then(res => res.data.commits)
        // add `files`, augment `tree` on each commit
        .then(pushedCommits =>
          Promise.all(
            pushedCommits.map(async pushedCommit => {
              const commitSha = pushedCommit.sha;
              const treeSha = pushedCommit.commit.tree.sha;
              const [files, tree] = await Promise.all([
                this.request('GET /repos/:repoName/commits/:commitSha', {
                  commitSha,
                  repoName,
                }).then(res =>
                  this._populateFilesContent({
                    files: res.data.files,
                    ref: commitSha,
                    repoName,
                  }),
                ),
                this.request('GET /repos/:repoName/git/trees/:treeSha', {
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

  async copyCommits(
    opts /*: {
      source: SourceOptType,
      target: TargetOptType,
    } */,
  ) /*: Promise<void> */ {
    const {source, target} = opts;
    // `parentTree` is a moving reference to the parent tree
    // for the current commit being copied; it's initially the
    // current tree of the target repo
    let [commits, parentTree] = await Promise.all([
      this._getCommitsInRange({
        repoName: source.repoName,
        beforeSha: source.beforeSha,
        afterSha: source.afterSha,
      }),
      this.request('GET /repos/:repoName/commits/:commitSha', {
        commitSha: target.sha,
        repoName: target.repoName,
      })
        .then(res =>
          this.request('GET /repos/:repoName/git/trees/:treeSha', {
            recursive: 1,
            repoName: target.repoName,
            treeSha: res.data.commit.tree.sha,
          }),
        )
        .then(res => res.data),
    ]);
    let lastCommitSha = target.sha;

    for (const origCommit of commits) {
      const newTree = this._getCopiedCommitTree({
        origCommit,
        parentTree,
        source,
        target,
      });

      if (newTree) {
        const commit = origCommit.commit;

        if (target.genericMessage) {
          commit.message = 'Clone commit from parent monorepo';
        }

        commit.message = COMMIT_MESSAGE_PREFIX + commit.message;
        const {sha, tree} = await this._commitTree({
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

    return this.request('PATCH /repos/:repoName/git/refs/heads/:branchName', {
      branchName: target.branch,
      repoName: target.repoName,
      data: {
        sha: lastCommitSha,
      },
    });
  }
};
