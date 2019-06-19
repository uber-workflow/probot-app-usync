/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {endpoint} from '@octokit/endpoint';
import LRU from 'lru-cache';

const URL_CACHE_PATTERNS = new Set([
  /^\/repos\/([^/]+\/){1,2}commits\/[^/]+\/?$/,
  /^\/repos\/([^/]+\/){1,2}contents\//,
  /^\/repos\/([^/]+\/){1,2}git\/trees\/[^/]+\/?$/,
]);
const CACHE = new LRU({max: 50000});

function shouldCacheRequest(options) {
  if (options.method === 'GET') {
    for (const pattern of URL_CACHE_PATTERNS) {
      if (pattern.test(options.url)) {
        return true;
      }
    }
  }

  return false;
}

export default function OctokitCachePlugin(octokit) {
  if (process.env.MONOREPO_SYNC_DISABLE_CACHE) {
    console.log(
      '`MONOREPO_SYNC_DISABLE_CACHE` environment var present; disabling request cache',
    );
  } else {
    octokit.hook.wrap('request', async (request, options) => {
      const shouldCache = shouldCacheRequest(options);
      const resolvedUrl = endpoint(options).url;

      if (shouldCache && CACHE.has(resolvedUrl)) {
        return CACHE.get(resolvedUrl);
      }

      const response = await request(options);

      if (shouldCache) {
        CACHE.set(resolvedUrl, response);
      }

      return response;
    });
  }
}
