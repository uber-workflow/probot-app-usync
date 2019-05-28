/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const esmRequire = require('esm')(module);
const {
  base64Decode,
  base64Encode,
  queue,
  sequential,
  throttleWebhook,
} = esmRequire('./utils.js');

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

test('sequential', async () => {
  const result = await sequential([
    () => 1,
    async count => count + 1,
    count => new Promise(resolve => resolve(count + 1)),
    count => count + 1,
  ]);

  expect(result).toBe(4);
});

test('throttleWebhook', async done => {
  let calls = 0;
  let callArgs = [];

  async function handler(arg) {
    calls++;
    callArgs.push(arg);

    if (arg === 'qux') {
      expect(calls).toBe(2);
      expect(callArgs).toEqual(['foo', 'qux']);
      done();
    }
  }

  const dummyThrottler = throttleWebhook('dummy-key', 0, async () => {});
  const mainThrottler = throttleWebhook('main-key', 200, handler);

  dummyThrottler('foo');
  mainThrottler('foo');
  await sleep(200);
  mainThrottler('bar');
  mainThrottler('baz');
  await sleep(100);
  mainThrottler('qux');
});
