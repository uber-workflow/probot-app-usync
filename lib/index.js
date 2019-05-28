/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {syncPR, syncPRMeta, syncPRState, syncPRStatuses} from './sync/index.js';
import {getOpenPRs} from './graphql.js';
import {getRepoNames} from './relationships.js';
import {throttleWebhook} from './utils.js';

async function init() {
  for (const repoName of getRepoNames()) {
    const pullRequests = await getOpenPRs(
      '{number}',
      {repoName},
      'repository.pullRequests.nodes',
    );

    for (const pullRequest of pullRequests) {
      await syncPR({
        number: pullRequest.number,
        repoName,
      });
    }
  }
}

export default function(app) {
  init().catch(console.error);

  app.on(
    [
      'pull_request.closed',
      'pull_request.edited',
      'pull_request.opened',
      'pull_request.reopened',
      'pull_request.synchronize',
    ],
    async ({payload}) => {
      const pullRequest = {
        number: payload.pull_request.number,
        repoName: payload.repository.full_name,
      };

      switch (payload.action) {
        case 'closed':
        case 'reopened':
          return syncPRState(pullRequest);
        case 'edited':
          return syncPRMeta(pullRequest);
        case 'opened':
        case 'synchronize':
          return syncPR(pullRequest);
      }
    },
  );

  app.on('status', async ({payload}) => {
    // throttle this since it's sometimes triggered more than 20 times within
    // a window of ~10 seconds
    const handler = throttleWebhook(payload.sha, 3000, async payload =>
      syncPRStatuses({
        branchNames: payload.branches,
        repoName: payload.repository.full_name,
      }),
    );

    handler(payload);
  });
}
