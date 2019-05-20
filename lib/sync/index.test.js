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
  parsePRBodyMeta,
  parseSecondaryBranchName,
} = esmRequire('./index.js');

test(`generateSecondaryBranchName`, () => {
  expect(generateSecondaryBranchName('foo/bar', 10)).toBe('foo/bar/10');
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

test(`parsePRBodyMeta`, () => {
  const fixture = `This is my test PR, hope you enjoy it!

<!--
# comment

meta:
  foo: bar
  # comment
  bar :baz
-->`;
  const fixtureMultiline = `<!--
meta:
  foo:bar baz
    qux quux
qwop
  # comment
  bar: baz
-->`;
  const fixtureNoData = `This is my test PR, hope you enjoy it!
<!--
meta:
-->`;
  const fixtureNoMeta = `This is my test PR, hope you enjoy it!`;

  expect(parsePRBodyMeta(fixture)).toEqual({
    foo: 'bar',
    bar: 'baz',
  });
  expect(parsePRBodyMeta(fixtureMultiline)).toEqual({
    foo: 'bar baz\nqux quux\nqwop',
    bar: 'baz',
  });
  expect(parsePRBodyMeta(fixtureNoData)).toEqual({});
  expect(parsePRBodyMeta(fixtureNoMeta)).toEqual({});
});

test(`parseSecondaryBranchName`, () => {
  expect(parseSecondaryBranchName('foo/bar/10')).toEqual({
    number: 10,
    repoName: 'foo/bar',
  });
});
