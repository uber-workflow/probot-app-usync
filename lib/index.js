/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {generateKeyFromPR, syncPR} from './sync/index.js';
import {isSyncStatusContext} from './sync/commit-status.js';
import * as cache from './cache.js';
import {getGithubId, request} from './github.js';
import {getRepoNames} from './relationships.js';
import {throttleWebhook} from './utils.js';

async function syncOpenPRs() {
  for (const repoName of getRepoNames()) {
    const pullRequests = await request('GET /repos/:repoName/pulls', {
      repoName,
    }).then(res => res.data || []);

    for (const pullRequest of pullRequests) {
      const {number} = pullRequest;
      const cacheKey = generateKeyFromPR({number, repoName});

      // if it already has a cached partner, we can assume it's
      // already been synced
      if (!cache.get(`partner-prs.${cacheKey}`)) {
        await syncPR({number, repoName});
      }
    }
  }
}

export default function(app) {
  syncOpenPRs().catch(console.error);

  app.on(
    [
      'pull_request.closed',
      'pull_request.edited',
      'pull_request.opened',
      'pull_request.reopened',
      'pull_request.synchronize',
    ],
    async ({payload}) => {
      if (payload.sender.id === (await getGithubId())) return;

      const pullRequest = {
        number: payload.pull_request.number,
        repoName: payload.repository.full_name,
      };

      switch (payload.action) {
        case 'closed':
        case 'reopened':
          return syncPR(pullRequest, ['state']);
        case 'edited':
          return syncPR(pullRequest, ['meta']);
        case 'opened':
        case 'synchronize':
          return syncPR(pullRequest, ['commits', 'state']);
      }
    },
  );

  app.on('status', async ({payload}) => {
    if (isSyncStatusContext(payload.context)) return;

    // throttle this since it's sometimes triggered more than 20 times within
    // a window of ~10 seconds
    const handler = throttleWebhook(payload.sha, 10000, async payload => {
      syncPR(
        {
          commitSha: payload.sha,
          repoName: payload.repository.full_name,
        },
        ['statuses'],
      );
    });

    handler(payload);
  });
}
