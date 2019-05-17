/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';

const REPO_RELATIONSHIP_MAP = parseEnv(process.env.REPO_RELATIONSHIPS);

if (!REPO_RELATIONSHIP_MAP.size) {
  console.warn('No repo relationships configured!');
}

/*
 * comma separated relationships in `[parent repo] > [sub-path]:[child repo]` format
 *
 * e.g. "fusionjs/parent > child/dir/path:fusionjs/child"
 *   - indicates that "fusionjs/child" is a child of "fusionjs/parent" and exists in the
 *     "child/dir/path" directory
 */
// only exported for tests
export function parseEnv(input) {
  if (!input) return new Map();

  return input.split(/, ?/).reduce((map, relationship) => {
    const [parentRepo, childConfigStr] = relationship.split(/ ?> ?/);
    const childPath = childConfigStr
      .split(':', 1)[0]
      // strip trailing slash
      .replace(/\/$/, '');
    const childRepo = childConfigStr
      .split(':')
      .slice(1)
      .join(':');
    const childConfig = map.get(childRepo) || {};
    const parentConfig = map.get(parentRepo) || {};

    if (!parentConfig.children) {
      parentConfig.children = [];
    }

    childConfig.parent = parentRepo;
    parentConfig.children.push({name: childRepo, path: childPath});
    map.set(childRepo, childConfig);
    map.set(parentRepo, parentConfig);
    return map;
  }, new Map());
}

export function getParentName(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'parent');
}

export function getChildren(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'children') || [];
}

export function getChildrenNames(repoName) {
  return getChildren(repoName).map(child => child.name);
}

export function getChild(parentRepoName, childRepoName) {
  return getChildren(parentRepoName).find(
    child => child.name === childRepoName,
  );
}

export function hasChildren(repoName) {
  return !!getChildren(repoName).length;
}

export function hasParent(repoName) {
  return !!getParentName(repoName);
}

export function hasRelationship(repoName) {
  return REPO_RELATIONSHIP_MAP.has(repoName);
}
