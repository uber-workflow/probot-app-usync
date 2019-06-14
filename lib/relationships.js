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

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 * }} ChildType
 */

/**
 * comma separated relationships in `[parent repo] > [sub-path]:[child repo]` format
 *
 * e.g. "fusionjs/parent > child/dir/path:fusionjs/child"
 *   - indicates that "fusionjs/child" is a child of "fusionjs/parent" and exists in the
 *     "child/dir/path" directory
 *
 * @param {string} input
 * @returns {Map<string, {
 *   children?: ChildType[],
 *   parent?: string,
 * }>}
 */
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

/**
 * @param {string} repoName
 * @returns {string}
 */
export function getParentName(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'parent');
}

/**
 * @param {string} repoName
 * @returns {ChildType[]}
 */
export function getChildren(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'children') || [];
}

/**
 * @param {string} repoName
 * @returns {string[]}
 */
export function getChildrenNames(repoName) {
  return getChildren(repoName).map(child => child.name);
}

/**
 * @param {string} parentRepoName
 * @param {string} childRepoName
 * @returns {ChildType | void}
 */
export function getChild(parentRepoName, childRepoName) {
  return getChildren(parentRepoName).find(
    child => child.name === childRepoName,
  );
}

/**
 * @param {string} parentRepoName
 * @param {string} childRepoName
 * @returns {string | void}
 */
export function getChildPath(parentRepoName, childRepoName) {
  return get(getChild(parentRepoName, childRepoName), 'path');
}

/**
 * @param {string} repoName
 * @returns {string[]}
 */
export function getRelatedRepoNames(repoName) {
  return []
    .concat(getParentName(repoName))
    .concat(getChildrenNames(repoName))
    .filter(Boolean);
}

/**
 * Gets the first repo's relationship to the second repo;
 * e.g. first repo is second repo's 'parent'
 * e.g. first repo is second repo's 'child'
 * @param {string} firstRepoName
 * @param {string} secondRepoName
 * @returns {'child' | 'parent' | void}
 */
export function getRelation(firstRepoName, secondRepoName) {
  if (hasRelationship(firstRepoName) && hasRelationship(secondRepoName)) {
    if (getParentName(firstRepoName) === secondRepoName) {
      return 'child';
    } else if (getParentName(secondRepoName) === firstRepoName) {
      return 'parent';
    }
  }
}

/**
 * @returns {string[]}
 */
export function getRepoNames() {
  return [...REPO_RELATIONSHIP_MAP].map(entry => entry[0]);
}

/**
 * @param {string} repoName
 * @returns {boolean}
 */
export function hasChildren(repoName) {
  return !!getChildren(repoName).length;
}

/**
 * @param {string} repoName
 * @returns {boolean}
 */
export function hasParent(repoName) {
  return !!getParentName(repoName);
}

/**
 * @param {string} repoName
 * @returns {boolean}
 */
export function hasRelationship(repoName) {
  return REPO_RELATIONSHIP_MAP.has(repoName);
}
