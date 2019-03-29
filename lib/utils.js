/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

function base64Decode(input) {
  return Buffer.from(input, 'base64').toString('utf8');
}

function base64Encode(input) {
  return Buffer.from(input).toString('base64');
}

// see .env.example for format of input
function parseRelationshipStr(input) {
  return (input || '').split(/, ?/).reduce((map, relationship) => {
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
  base64Decode,
  base64Encode,
  parseRelationshipStr,
  sequence,
};
