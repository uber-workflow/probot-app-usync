/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {
  base64Decode,
  base64Encode,
  onQueueIdle,
  queue,
  QUEUES,
  sequence,
} = require('./utils.js');

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

test('onQueueIdle', async () => {
  const result = [];

  queue('foo', async () => {
    await sleep(10);
    result.push('foo');
  });

  await onQueueIdle('foo').then(() => {
    result.push('done');
  });

  expect(result).toEqual(['foo', 'done']);
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
