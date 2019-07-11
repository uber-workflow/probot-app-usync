/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  generateSecondaryPRMeta,
  parsePRMetadata,
  stripPRMetadata,
} from './pr-meta.js';

test(`generateSecondaryPRMeta`, () => {
  const fixtures = {
    child: {title: 'foo', body: 'foo'},
    childEmptyBody: {title: 'foo', body: ''},
    parentNoMetadata: {
      title: 'foo',
      body: '',
    },
    parentWithMetadata: {
      title: 'foo',
      body: `<!--\nmeta:\n  publicTitle: bar\n  publicBody:\n-->`,
    },
    parentWithMetadataAndMatch: {
      title: 'foo',
      body: `<!--\nmeta:\n  publicTitle: MATCH\n  publicBody: baz\n-->`,
    },
  };

  expect(generateSecondaryPRMeta(fixtures.child, 'child')).toEqual(
    fixtures.child,
  );
  expect(generateSecondaryPRMeta(fixtures.childEmptyBody, 'child')).toEqual(
    fixtures.childEmptyBody,
  );
  expect(generateSecondaryPRMeta(fixtures.parentNoMetadata, 'parent')).toEqual({
    title: 'Sync pull request from parent repo',
    body: '',
  });
  expect(
    generateSecondaryPRMeta(fixtures.parentWithMetadata, 'parent'),
  ).toEqual({
    title: 'bar',
    body: '',
  });
  expect(
    generateSecondaryPRMeta(fixtures.parentWithMetadataAndMatch, 'parent'),
  ).toEqual({
    title: 'foo',
    body: 'baz',
  });
});

test(`parsePRMetadata`, () => {
  const fixtures = {
    simple: `This is my test PR, hope you enjoy it!

<!--
# comment

meta:
  foo: bar
  # comment
  bar :baz
-->`,
    multilineAndEmpty: `<!--
meta:
  foo:bar baz
    qux quux
qwop
  # comment
  bar:
-->`,
    noData: `This is my test PR, hope you enjoy it!
<!--
meta:
-->`,
    noMeta: `This is my test PR, hope you enjoy it!`,
  };

  expect(parsePRMetadata(fixtures.simple)).toEqual({
    foo: 'bar',
    bar: 'baz',
  });
  expect(parsePRMetadata(fixtures.multilineAndEmpty)).toEqual({
    foo: 'bar baz\nqux quux\nqwop',
  });
  expect(parsePRMetadata(fixtures.noData)).toEqual({});
  expect(parsePRMetadata(fixtures.noMeta)).toEqual({});
});

test(`stripPRMetadata`, () => {
  const fixtures = {
    simple: `<!--
# comment

meta:
  foo: bar
  # comment
  bar :baz
-->

This is my test PR, hope you enjoy it!`,
    otherComment: `This is my test PR, hope you enjoy it!
<!-- some comment here -->

<!--
# comment

meta:
  foo: bar
  # comment
  bar :baz
-->`,
    noMeta: `This is my test PR, hope you enjoy it!`,
  };

  expect(stripPRMetadata(fixtures.simple)).toBe(
    'This is my test PR, hope you enjoy it!',
  );
  expect(stripPRMetadata(fixtures.otherComment)).toBe(
    'This is my test PR, hope you enjoy it!\n<!-- some comment here -->\n\n',
  );
  expect(stripPRMetadata(fixtures.noMeta)).toBe(
    'This is my test PR, hope you enjoy it!',
  );
});
