const get = require('just-safe-get');

const REPO_RELATIONSHIP_MAP = parseEnv(process.env.REPO_RELATIONSHIPS);

if (!REPO_RELATIONSHIP_MAP.size) {
  // eslint-disable-next-line no-console
  console.warn('No repo relationships configured!');
}

/*
 * comma separated relationships in `[parent repo] > [sub-path]:[child repo]` format
 *
 * e.g. "fusionjs/parent > child/dir/path:fusionjs/child"
 *   - indicates that "fusionjs/child" is a child of "fusionjs/parent" and exists in the
 *     "child/dir/path" directory
 */
function parseEnv(input) {
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

function getParentName(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'parent');
}

function getChildren(repoName) {
  return get(REPO_RELATIONSHIP_MAP.get(repoName), 'children') || [];
}

function getChildrenNames(repoName) {
  return getChildren(repoName).map(child => child.name);
}

function getChild(parentRepoName, childRepoName) {
  return getChildren(parentRepoName).find(
    child => child.name === childRepoName,
  );
}

function hasChildren(repoName) {
  return !!getChildren(repoName).length;
}

function hasParent(repoName) {
  return !!getParentName(repoName);
}

function hasRelationship(repoName) {
  return REPO_RELATIONSHIP_MAP.has(repoName);
}

module.exports = {
  getChild,
  getChildrenNames,
  getChildren,
  getParentName,
  hasChildren,
  hasParent,
  hasRelationship,
  // only exported for tests
  parseEnv,
};
