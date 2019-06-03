/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const clone = require('just-clone');
const esmRequire = require('esm')(module);
const {
  copyCommitTree,
  getCommitsState,
  parseCommitMeta,
  stripCommitMeta,
} = esmRequire('./commits.js');
const {base64Encode} = esmRequire('../utils.js');

describe('getCommitsState', () => {
  test('simple', () => {
    const primaryFixture = [
      {
        message: 'foo',
        oid: '000',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:011',
        oid: '001',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '002',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        oid: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '011',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:002',
        oid: '012',
        shouldSync: true,
      },
    ];

    expect(getCommitsState(primaryFixture, secondaryFixture)).toEqual({
      copySource: undefined,
      hasConflict: false,
      hasMismatch: false,
      lastCommonPrimaryIndex: 2,
      lastCommonSecondaryIndex: 2,
    });
  });

  test('conflict', () => {
    const primaryFixture = [
      {
        message: 'foo',
        oid: '000',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '002',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        oid: '010',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:001',
        oid: '011',
        shouldSync: true,
      },
    ];

    expect(getCommitsState(primaryFixture, secondaryFixture)).toEqual({
      copySource: 'primary',
      hasConflict: true,
      hasMismatch: true,
      lastCommonPrimaryIndex: 0,
      lastCommonSecondaryIndex: 0,
    });
  });

  test('missing commits', () => {
    const primaryFixture = [
      {
        message: 'foo',
        oid: '000',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:011',
        oid: '001',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        oid: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '011',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '012',
        shouldSync: true,
      },
    ];

    expect(getCommitsState(primaryFixture, secondaryFixture)).toEqual({
      copySource: 'secondary',
      hasConflict: false,
      hasMismatch: true,
      lastCommonPrimaryIndex: 1,
      lastCommonSecondaryIndex: 1,
    });
  });

  test('skipped + missing commits', () => {
    const primaryFixture = [
      {
        message: 'foo',
        oid: '000',
        shouldSync: false,
      },
      {
        message: 'foo',
        oid: '001',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:001',
        oid: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        oid: '011',
        shouldSync: true,
      },
    ];

    expect(getCommitsState(primaryFixture, secondaryFixture)).toEqual({
      copySource: 'secondary',
      hasConflict: false,
      hasMismatch: true,
      lastCommonPrimaryIndex: 1,
      lastCommonSecondaryIndex: 0,
    });
  });

  test('no common commits', () => {
    const primaryFixture = [
      {
        message: 'foo',
        oid: '000',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo',
        oid: '010',
        shouldSync: true,
      },
    ];

    expect(getCommitsState(primaryFixture, secondaryFixture)).toEqual({
      copySource: 'primary',
      hasConflict: true,
      hasMismatch: true,
      lastCommonPrimaryIndex: undefined,
      lastCommonSecondaryIndex: undefined,
    });
  });
});

test(`commit meta`, () => {
  const fixtureWithMetadata = `Update some file\n\nmeta:skipSync;sha:0000000`;
  const fixtureWithTrailer = `Update some file\n\nmeta:skipSync;sha:0000000\n\nCo-authored-by:`;
  const fixtureWithNoMetadata = `Update some file`;

  expect(parseCommitMeta(fixtureWithMetadata)).toEqual({
    sha: '0000000',
    skipSync: true,
  });
  expect(stripCommitMeta(fixtureWithMetadata)).toEqual('Update some file');

  expect(parseCommitMeta(fixtureWithTrailer)).toEqual({
    sha: '0000000',
    skipSync: true,
  });
  expect(stripCommitMeta(fixtureWithTrailer)).toEqual(
    'Update some file\n\nCo-authored-by:',
  );

  expect(parseCommitMeta(fixtureWithNoMetadata)).toEqual({});
  expect(stripCommitMeta(fixtureWithNoMetadata)).toEqual('Update some file');
});

describe('copyCommitTree', () => {
  test(`doesn't copy commit if it doesn't contain files inside 'source.subPath'`, () => {
    expect(
      copyCommitTree({
        commitInfo: {
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
      copyCommitTree({
        commitInfo: {
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
        parentTree,
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
      copyCommitTree({
        commitInfo: {
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
        parentTree,
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
      copyCommitTree({
        commitInfo: {
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
        parentTree,
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
