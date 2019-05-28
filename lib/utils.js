/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Queue from 'p-queue';

const QUEUES = new Map();
const THROTTLERS = new Map();

export function base64Decode(input) {
  return Buffer.from(input, 'base64').toString('utf8');
}

export function base64Encode(input) {
  return Buffer.from(input).toString('base64');
}

// add tasks to a specific queue based on key
export function queue(key, task) {
  if (!QUEUES.has(key)) {
    QUEUES.set(key, new Queue({concurrency: 1}));
  }

  return QUEUES.get(key).add(task);
}

// calls array of steps sequentially, passing each return
// value to the next step; basically just to avoid having
// to write a huge chain of .then()
export async function sequential(steps) {
  let promise = Promise.resolve();

  for (const step of steps) {
    promise = step(await promise);
  }

  return promise;
}

// for writing inline async functions to be called in parallel
export async function parallel(tasks) {
  return Promise.all(tasks.map(task => task()));
}

export function throttleWebhook(key, ms, handler) {
  return async context => {
    if (THROTTLERS.has(key)) {
      clearTimeout(THROTTLERS.get(key));
    }

    THROTTLERS.set(
      key,
      setTimeout(() => {
        THROTTLERS.delete(key);
        handler(context).catch(console.error);
      }, ms),
    );
  };
}
