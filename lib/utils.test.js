/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {
  base64Decode,
  base64Encode,
  parseRelationshipStr,
  queue,
  QUEUES,
  sequence,
} = require('./utils.js');
const {sleep} = require('./_test-utils.js');

test('base64', () => {
  expect(base64Decode(base64Encode('foo bar'))).toBe('foo bar');
});

test('parseRelationshipStr', () => {
  const tests = {
    'foo/bar > bar/:bar/baz': {
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

test('queue', async () => {
  const result = [];

  queue('foo', async () => {
    await sleep(10);
    result.push('foo');
  });
  queue('foo', async () => {
    await sleep(10);
    result.push('foo');
  });
  queue('bar', async () => {
    await sleep(10);
    result.push('bar');
  });
  // wait for all queues to idle
  await Promise.all(
    Array.from(QUEUES).map(async ([, keyQueue]) => keyQueue.onIdle()),
  );

  expect(result).toEqual(['foo', 'bar', 'foo']);
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
