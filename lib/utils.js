/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// see .env.example for format of input
function parseRelationshipStr(input) {
  const result = (input || '').split(/, ?/).reduce((map, relationship) => {
    const [parentRepo, childConfigStr] = relationship.split(/ ?> ?/);
    const childPath = childConfigStr.split(':', 1)[0];
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

  return result;
}

// calls array of steps in sequence, passing each return
// value to the next step; basically just to avoid having
// to write a huge chain of .then()
async function sequence(steps) {
  let promise = Promise.resolve();

  for (const step of steps) {
    promise = step(await promise);
  }

  return promise;
}

module.exports = {
  parseRelationshipStr,
  sequence,
};
