/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const esmRequire = require('esm')(module);
const {
  generateSecondaryBranchName,
  // getPartnerPR,
  // getSecondaryCandidate,
  isSecondaryBranchName,
  parseCommitMeta,
  parseSecondaryBranchName,
} = esmRequire('./index.js');

test(`generateSecondaryBranchName`, () => {
  expect(
    generateSecondaryBranchName({
      number: 10,
      repoName: 'foo/bar',
    }),
  ).toBe('foo/bar/10');
});

// TODO:
// test(`getPartnerPR`, () => {
//   // https://github.com/octokit/graphql.js#writing-tests
// });

// TODO:
// test(`getSecondaryCandidate`, () => {
//   // https://github.com/octokit/graphql.js#writing-tests
// });

test(`isSecondaryBranchName`, () => {
  expect(isSecondaryBranchName('foo/bar/10')).toBe(true);
  expect(isSecondaryBranchName('foo')).toBe(false);
});

test(`parseCommitMeta`, () => {
  const fixtureWithMetadata = `Update some file

meta:skipSync;sha:0000000`;
  const fixtureWithTrailer = `Update some file

meta:skipSync;sha:0000000

Co-authored-by:`;
  const fixtureWithNoMetadata = `Update some file`;

  expect(parseCommitMeta(fixtureWithMetadata)).toEqual({
    sha: '0000000',
    skipSync: true,
  });
  expect(parseCommitMeta(fixtureWithTrailer)).toEqual({
    sha: '0000000',
    skipSync: true,
  });
  expect(parseCommitMeta(fixtureWithNoMetadata)).toEqual({});
});

test(`parseSecondaryBranchName`, () => {
  expect(parseSecondaryBranchName('foo/bar/10')).toEqual({
    number: 10,
    repoName: 'foo/bar',
  });
});
