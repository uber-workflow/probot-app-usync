/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {parseRelationshipStr, sequence} = require('./utils.js');

test('parseRelationshipStr', () => {
  const tests = {
    'foo/bar > bar:bar/baz': {
      'foo/bar': {
        children: [{name: 'bar/baz', path: 'bar'}],
      },
      'bar/baz': {parent: 'foo/bar'},
    },
  };

  for (const [input, expectedEntries] of Object.entries(tests)) {
    const output = parseRelationshipStr(input);

    for (const [key, value] of Object.entries(expectedEntries)) {
      expect(output.get(key)).toEqual(value);
    }
  }
});

test('sequence', async () => {
  const result = await sequence([
    () => 1,
    async count => count + 1,
    count => new Promise(resolve => resolve(count + 1)),
    count => count + 1,
  ]);

  expect(result).toBe(4);
});
