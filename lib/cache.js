/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import safeGet from 'just-safe-get';
import safeSet from 'just-safe-set';

let CACHE = {};

export function get(path) {
  return safeGet(CACHE, path);
}

export function set(path, value) {
  return safeSet(CACHE, path, value);
}

export function clear(path) {
  if (path) {
    set(path, null);
  } else {
    CACHE = {};
  }
}
