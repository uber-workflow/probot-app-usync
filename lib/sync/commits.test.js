/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import clone from 'just-clone';
import extend from 'just-extend';
import nock from 'nock';
import commitFixture from '../__fixtures__/commit.json';
import refFixture from '../__fixtures__/ref.json';
import * as cache from '../cache.js';
import {base64Encode} from '../utils.js';
import {
  copyCommitTree,
  getCommitsState,
  getPartnerRebaseSha,
  parseCommitMeta,
  stripCommitMeta,
} from './commits.js';

jest.mock('../github/utils.js');
nock.disableNetConnect();

describe('getCommitsState', () => {
  test('simple', () => {
    const primaryFixture = [
      {
        message: 'foo',
        sha: '000',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:011',
        sha: '001',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '002',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        sha: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '011',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:002',
        sha: '012',
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
        sha: '000',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '002',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        sha: '010',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:001',
        sha: '011',
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
        sha: '000',
        shouldSync: true,
      },
      {
        message: 'foo\n\nmeta:sha:011',
        sha: '001',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:000',
        sha: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '011',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '012',
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
        sha: '000',
        shouldSync: false,
      },
      {
        message: 'foo',
        sha: '001',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo\n\nmeta:sha:001',
        sha: '010',
        shouldSync: true,
      },
      {
        message: 'foo',
        sha: '011',
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
        sha: '000',
        shouldSync: true,
      },
    ];
    const secondaryFixture = [
      {
        message: 'foo',
        sha: '010',
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

describe('getPartnerRebaseSha', () => {
  afterEach(() => {
    nock.cleanAll();
    cache.clear();
  });

  /*
   * direct partner commit:
   * syncing rebase of source:feature (a2) onto source:master (a3)
   *
   * source:master
   * a1----a3
   * source:feature (before rebase)
   * a1-a2
   * source:feature (after rebase)
   * a1-a3-a2
   *
   * target:master
   * b1----b3
   * target:feature (current)
   * b1-b2
   * target:feature (expected)
   * b1-b3-b2
   */
  test('direct partner commit (sync from parent repo)', async () => {
    const fixtures = {
      commits: {
        a3: extend({}, commitFixture, {
          sha: 'a3',
          commit: {
            message: 'update something',
          },
          files: [{filename: `foo/bar.txt`}],
          parents: [{sha: 'a1'}],
        }),
        b3: extend({}, commitFixture, {
          sha: 'b3',
          commit: {
            message: 'update something\n\nmeta:sha:a3',
          },
          files: [{filename: `bar.txt`}],
          parents: [{sha: 'b1'}],
        }),
      },
      refs: {
        targetMaster: extend({}, refFixture, {
          object: {
            sha: 'b3',
          },
        }),
      },
    };

    nock('https://api.github.com')
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/target-repo/git/refs/heads/master')
      .reply(200, fixtures.refs.targetMaster)
      .get('/repos/org/target-repo/commits/b3')
      .reply(200, fixtures.commits.b3);

    expect(
      await getPartnerRebaseSha({
        commitSha: 'a3',
        partnerBranch: 'master',
        partnerRepoName: 'org/target-repo',
        repoName: 'org/source-repo',
        subPath: 'foo',
      }),
    ).toBe('b3');
  });

  test('direct partner commit (sync from child repo)', async () => {
    const fixtures = {
      commits: {
        a3: extend({}, commitFixture, {
          sha: 'a3',
          commit: {
            message: 'update something\n\nmeta:sha:b3',
          },
          files: [{filename: `bar.txt`}],
          parents: [{sha: 'a1'}],
        }),
        b3: extend({}, commitFixture, {
          sha: 'b3',
          commit: {
            message: 'update something',
          },
          files: [{filename: `foo/bar.txt`}],
          parents: [{sha: 'b1'}],
        }),
      },
    };

    nock('https://api.github.com')
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/target-repo/commits/b3')
      .reply(200, fixtures.commits.b3);

    expect(
      await getPartnerRebaseSha({
        commitSha: 'a3',
        partnerBranch: 'master',
        partnerRepoName: 'org/target-repo',
        repoName: 'org/source-repo',
      }),
    ).toBe('b3');
  });

  /*
   * indirect partner commit:
   * syncing rebase of source:feature (a2) onto source:master (a4);
   * a4 doesn't modify files in `subPath` so doesn't exist in target repo
   *
   * source:master
   * a1----a3-a4
   * source:feature (before rebase)
   * a1-a2
   * source:feature (after rebase)
   * a1-a3-a4-a2
   *
   * target:master
   * b1----b3
   * target:feature (current)
   * b1-b2
   * target:feature (expected)
   * b1-b3-b2
   */
  test('indirect partner commit', async () => {
    const fixtures = {
      commits: {
        a4: extend({}, commitFixture, {
          sha: 'a4',
          commit: {
            message: "update something that won't be synced",
          },
          files: [{filename: `baz.txt`}],
          parents: [{sha: 'a3'}],
        }),
        a3: extend({}, commitFixture, {
          sha: 'a3',
          commit: {
            message: 'update something',
          },
          files: [{filename: `foo/bar.txt`}],
          parents: [{sha: 'a1'}],
        }),
        b3: extend({}, commitFixture, {
          sha: 'b3',
          commit: {
            message: 'update something\n\nmeta:sha:a3',
          },
          files: [{filename: `bar.txt`}],
          parents: [{sha: 'b1'}],
        }),
      },
      refs: {
        targetMaster: extend({}, refFixture, {
          object: {
            sha: 'b3',
          },
        }),
      },
    };

    nock('https://api.github.com')
      .get('/repos/org/source-repo/commits/a4')
      .reply(200, fixtures.commits.a4)
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/source-repo/commits/a3')
      .reply(200, fixtures.commits.a3)
      .get('/repos/org/target-repo/git/refs/heads/master')
      .reply(200, fixtures.refs.targetMaster)
      .get('/repos/org/target-repo/commits/b3')
      .reply(200, fixtures.commits.b3);

    expect(
      await getPartnerRebaseSha({
        commitSha: 'a4',
        partnerBranch: 'master',
        partnerRepoName: 'org/target-repo',
        repoName: 'org/source-repo',
        subPath: 'foo',
      }),
    ).toBe('b3');
  });

  /*
   * no partner commit:
   * syncing rebase of source:feature (a2) onto source:master (ax);
   * ax *does* modify files in subPath, but doesn't exist in target repo
   *
   * source:master
   * a1----ax
   * source:feature (before rebase)
   * a1-a2
   * source:feature (after rebase)
   * a1-ax-a2
   *
   * target:master
   * b1
   * target:feature
   * b1-b2
   */
  test('no partner commit', async () => {
    const fixtures = {
      commits: {
        ax: extend({}, commitFixture, {
          sha: 'ax',
          commit: {
            message: 'update something',
          },
          files: [{filename: `foo/bar.txt`}],
          parents: [{sha: 'a1'}],
        }),
        b1: extend({}, commitFixture, {
          sha: 'b1',
          commit: {
            message: 'init commit',
          },
          files: [{filename: `bar.txt`}],
          parents: [],
        }),
      },
      refs: {
        targetMaster: extend({}, refFixture, {
          object: {
            sha: 'b1',
          },
        }),
      },
    };

    nock('https://api.github.com')
      .get('/repos/org/source-repo/commits/ax')
      .reply(200, fixtures.commits.ax)
      .get('/repos/org/source-repo/commits/ax')
      .reply(200, fixtures.commits.ax)
      .get('/repos/org/target-repo/git/refs/heads/master')
      .reply(200, fixtures.refs.targetMaster)
      .get('/repos/org/target-repo/commits/b1')
      .reply(200, fixtures.commits.b1);

    expect(
      await getPartnerRebaseSha({
        commitSha: 'ax',
        fallbackSha: 'b1',
        partnerBranch: 'master',
        partnerRepoName: 'org/target-repo',
        repoName: 'org/source-repo',
        subPath: 'foo',
      }),
    ).toBe('b1');
  });
});
