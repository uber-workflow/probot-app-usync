/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const esmRequire = require('esm')(module);
const {parsePRMeta} = esmRequire('./pr-meta.js');

test(`parsePRMeta`, () => {
  const fixture = `This is my test PR, hope you enjoy it!

<!--
# comment

meta:
  foo: bar
  # comment
  bar :baz
-->`;
  const fixtureMultilineAndEmpty = `<!--
meta:
  foo:bar baz
    qux quux
qwop
  # comment
  bar:
-->`;
  const fixtureNoData = `This is my test PR, hope you enjoy it!
<!--
meta:
-->`;
  const fixtureNoMeta = `This is my test PR, hope you enjoy it!`;

  expect(parsePRMeta(fixture)).toEqual({
    foo: 'bar',
    bar: 'baz',
  });
  expect(parsePRMeta(fixtureMultilineAndEmpty)).toEqual({
    foo: 'bar baz\nqux quux\nqwop',
  });
  expect(parsePRMeta(fixtureNoData)).toEqual({});
  expect(parsePRMeta(fixtureNoMeta)).toEqual({});
});
