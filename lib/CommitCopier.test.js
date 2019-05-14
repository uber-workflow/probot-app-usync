/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const clone = require('just-clone');
const Octokit = require('@octokit/rest');
const esmRequire = require('esm')(module);
const {CommitCopier, COMMIT_MESSAGE_PREFIX} = esmRequire('./CommitCopier.js');
const {base64Encode} = esmRequire('./utils.js');

const copier = new CommitCopier(new Octokit());

describe('_getCopiedCommitTree', () => {
  test(`doesn't copy synced commit`, () => {
    expect(
      copier._getCopiedCommitTree({
        origCommit: {
          commit: {
            message: COMMIT_MESSAGE_PREFIX + 'foo',
          },
        },
        parentTree: [],
        source: {},
        target: {},
      }),
    ).toBe(undefined);
  });

  test(`doesn't copy commit if it doesn't contain files inside 'source.subPath'`, () => {
    expect(
      copier._getCopiedCommitTree({
        origCommit: {
          commit: {
            message: 'foo',
          },
          files: [
            {
              filename: 'readme.md',
            },
          ],
        },
        parentTree: [],
        source: {
          subPath: 'my-subpath',
        },
        target: {},
      }),
    ).toBe(undefined);
  });

  test(`populates tree file contents from changed commit files`, () => {
    const parentTree = [
      {
        mode: '100644',
        path: 'foo.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: 'bar.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: 'baz.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: 'qux.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: 'readme.md',
        sha: '000',
        type: 'blob',
      },
    ];
    const commitTree = clone(parentTree)
      // commit tree shouldn't have removed files
      .filter(leaf => leaf.path !== 'baz.txt')
      // commit tree should have renamed filepaths
      .map(leaf => {
        if (leaf.path === 'qux.txt') {
          leaf.path = 'new-qux.txt';
        }

        return leaf;
      });

    expect(
      copier._getCopiedCommitTree({
        origCommit: {
          commit: {
            message: 'foo',
            tree: {
              tree: commitTree,
            },
          },
          files: [
            {
              content: base64Encode('foo'),
              filename: 'foo.txt',
              status: 'added',
            },
            {
              content: base64Encode('bar'),
              filename: 'bar.txt',
              status: 'modified',
            },
            {
              content: base64Encode('baz'),
              filename: 'baz.txt',
              status: 'removed',
            },
            {
              content: base64Encode('qux'),
              filename: 'new-qux.txt',
              previous_filename: 'qux.txt',
              status: 'renamed',
            },
          ],
        },
        parentTree: {
          tree: parentTree,
        },
        source: {},
        target: {},
      }),
    ).toEqual([
      {
        content: 'foo',
        mode: '100644',
        path: 'foo.txt',
        type: 'blob',
      },
      {
        content: 'bar',
        mode: '100644',
        path: 'bar.txt',
        type: 'blob',
      },
      {
        content: 'qux',
        mode: '100644',
        path: 'new-qux.txt',
        type: 'blob',
      },
      {
        mode: '100644',
        path: 'readme.md',
        // unchanged file just keeps its sha
        sha: '000',
        type: 'blob',
      },
    ]);
  });

  test(`only provides tree files within 'source.subPath'`, () => {
    const subPath = 'my-subpath';
    const commitTree = [
      {
        mode: '100644',
        path: 'foo.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: `${subPath}/bar.txt`,
        sha: '000',
        type: 'blob',
      },
    ];
    const parentTree = clone(commitTree)
      // parent tree only includes files within the subPath
      .filter(leaf => leaf.path.startsWith(subPath))
      // strip subPath
      .map(leaf => {
        leaf.path = leaf.path.slice(subPath.length + 1);
        return leaf;
      });

    expect(
      copier._getCopiedCommitTree({
        origCommit: {
          commit: {
            message: 'foo',
            tree: {
              tree: commitTree,
            },
          },
          files: [
            {
              content: base64Encode('foo'),
              filename: 'foo.txt',
              status: 'modified',
            },
            {
              content: base64Encode('bar'),
              filename: `${subPath}/bar.txt`,
              status: 'modified',
            },
          ],
        },
        parentTree: {
          tree: parentTree,
        },
        source: {
          subPath,
        },
        target: {},
      }),
    ).toEqual([
      {
        content: 'bar',
        mode: '100644',
        path: 'bar.txt',
        type: 'blob',
      },
    ]);
  });

  test(`provides tree with updated files within 'target.subPath'`, () => {
    const subPath = 'my-subpath';
    const parentTree = [
      {
        mode: '100644',
        path: 'foo.txt',
        sha: '000',
        type: 'blob',
      },
      {
        mode: '100644',
        path: `${subPath}/bar.txt`,
        sha: '000',
        type: 'blob',
      },
    ];
    const commitTree = clone(parentTree)
      // commit tree only includes files within the subPath
      .filter(leaf => leaf.path.startsWith(subPath))
      // strip subPath
      .map(leaf => {
        leaf.path = leaf.path.slice(subPath.length + 1);
        return leaf;
      });

    expect(
      copier._getCopiedCommitTree({
        origCommit: {
          commit: {
            message: 'foo',
            tree: {
              tree: commitTree,
            },
          },
          files: [
            {
              content: base64Encode('bar'),
              filename: 'bar.txt',
              status: 'modified',
            },
          ],
        },
        parentTree: {
          tree: parentTree,
        },
        source: {},
        target: {
          subPath,
        },
      }),
    ).toEqual([
      {
        mode: '100644',
        path: 'foo.txt',
        sha: '000',
        type: 'blob',
      },
      {
        content: 'bar',
        mode: '100644',
        path: `${subPath}/bar.txt`,
        type: 'blob',
      },
    ]);
  });
});
