/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const esmRequire = require('esm')(module);
const {base64Decode, base64Encode, queue, sequence} = esmRequire('./utils.js');

function sleep(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

test('base64', () => {
  expect(base64Decode(base64Encode('foo bar'))).toBe('foo bar');
});

test('queue', async () => {
  const result = [];

  await Promise.all([
    queue('foo', async () => {
      await sleep(10);
      result.push('foo');
    }),
    queue('foo', async () => {
      await sleep(10);
      result.push('foo');
    }),
    queue('bar', async () => {
      await sleep(10);
      result.push('bar');
    }),
  ]);

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
