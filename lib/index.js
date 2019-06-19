/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {getUniqueOpenPRs, syncPR} from './sync/index.js';
import {isSyncStatusContext} from './sync/commit-status.js';
import {getGithubId, request} from './github';
import {throttleWebhook} from './utils.js';

async function initialize() {
  const pullRequests = await getUniqueOpenPRs();

  await Promise.all(
    pullRequests.map(async pullRequest => {
      try {
        await syncPR(pullRequest);
      } catch (error) {
        const {number, repoName} = pullRequest;
        console.error(`error syncing ${repoName}#${number}:`);
        console.error(error);
      }
    }),
  );
}

export default function(app) {
  initialize().catch(console.error);

  app.on(['pull_request.unlabeled'], async ({payload}) => {
    if (payload.label.name !== 'disable-sync') return;

    return syncPR({
      number: payload.pull_request.number,
      repoName: payload.repository.full_name,
    });
  });

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
          return syncPR(pullRequest, ['commits', 'state', 'statuses']);
      }
    },
  );

  // update statuses since push to master will make open PRs
  // out of date
  app.on('push', async ({payload}) => {
    if (payload.ref !== 'refs/heads/master') return;

    const repoName = payload.repository.full_name;
    const openPRs = await request('GET /repos/:repoName/pulls', {
      repoName,
    });

    return Promise.all(
      openPRs.map(pullRequest => {
        const {number} = pullRequest;
        return syncPR({number, repoName}, ['statuses']);
      }),
    );
  });

  app.on('status', async ({payload}) => {
    const isInMaster = payload.branches.some(
      branch => branch.name === 'master',
    );

    if (isInMaster || isSyncStatusContext(payload.context)) return;

    const commitSha = payload.sha;
    const repoName = payload.repository.full_name;
    // throttle this since it's sometimes triggered more than 20 times within
    // a window of ~10 seconds
    const handler = throttleWebhook(commitSha, 10000, async () =>
      syncPR({commitSha, repoName}, ['statuses']),
    );

    handler(payload);
  });
}
