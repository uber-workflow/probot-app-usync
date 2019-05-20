/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

let utils;

// silence warnings
console.warn = jest.fn();

function setEnv(value) {
  // force module re-load so env is re-parsed
  jest.resetModules();
  process.env.REPO_RELATIONSHIPS = value;
  utils = require('esm')(module)('./relationships.js');
}

beforeAll(() => setEnv(''));

test('parseEnv', () => {
  expect(utils.parseEnv('')).toEqual(new Map());
  expect(utils.parseEnv('foo/bar > bar/:bar/baz')).toEqual(
    new Map([
      ['foo/bar', {children: [{name: 'bar/baz', path: 'bar'}]}],
      ['bar/baz', {parent: 'foo/bar'}],
    ]),
  );
});

test('getChild', () => {
  setEnv('');
  expect(utils.getChild('foo', 'foo')).toBe(undefined);
  setEnv('parent > path/:child');
  expect(utils.getChild('parent', 'child')).toEqual({
    name: 'child',
    path: 'path',
  });
});

test('getChildrenNames', () => {
  setEnv('');
  expect(utils.getChildrenNames('foo')).toEqual([]);
  setEnv('parent > path/:child');
  expect(utils.getChildrenNames('parent')).toEqual(['child']);
});

test('getChildren', () => {
  setEnv('');
  expect(utils.getChildren('foo')).toEqual([]);
  setEnv('parent > path/:child');
  expect(utils.getChildren('parent')).toEqual([{name: 'child', path: 'path'}]);
});

test('getParentName', () => {
  setEnv('');
  expect(utils.getParentName('foo')).toBe(undefined);
  setEnv('parent > path/:child');
  expect(utils.getParentName('child')).toBe('parent');
});

test('getRelatedRepoNames', () => {
  setEnv('');
  expect(utils.getRelatedRepoNames('foo')).toEqual([]);
  setEnv('parent > path/:child, child > path:sub-child');
  expect(utils.getRelatedRepoNames('child')).toEqual(['parent', 'sub-child']);
});

test('getRelationship', () => {
  setEnv('');
  expect(utils.getRelationship('foo', 'bar')).toBe(undefined);
  setEnv('parent-repo > path/:child-repo');
  expect(utils.getRelationship('parent-repo', 'child-repo')).toBe('parent');
  expect(utils.getRelationship('child-repo', 'parent-repo')).toBe('child');
});

test('getRepoNames', () => {
  setEnv('');
  expect(utils.getRepoNames()).toEqual([]);
  setEnv('parent > path/:child');
  expect(utils.getRepoNames()).toEqual(['child', 'parent']);
});

test('hasChildren', () => {
  setEnv('');
  expect(utils.hasChildren('foo')).toBe(false);
  setEnv('parent > path/:child');
  expect(utils.hasChildren('child')).toBe(false);
  expect(utils.hasChildren('parent')).toBe(true);
});

test('hasParent', () => {
  setEnv('');
  expect(utils.hasParent('foo')).toBe(false);
  setEnv('parent > path/:child');
  expect(utils.hasParent('child')).toBe(true);
  expect(utils.hasParent('parent')).toBe(false);
});

test('hasRelationship', () => {
  setEnv('');
  expect(utils.hasRelationship('foo')).toBe(false);
  setEnv('parent > path/:child');
  expect(utils.hasRelationship('child')).toBe(true);
  expect(utils.hasRelationship('parent')).toBe(true);
});
