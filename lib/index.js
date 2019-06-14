/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {syncPR} from './sync/index.js';
import {isSyncStatusContext} from './sync/commit-status.js';
import * as cache from './cache.js';
import {getGithubId, request} from './github';
import {getRepoNames} from './relationships.js';
import {generateKeyFromPR, throttleWebhook} from './utils.js';

/**
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 */

/**
 * @returns {PROptType[]}
 */
async function getOpenPRs(repoName) {
  const pullRequests = await request('GET /repos/:repoName/pulls', {
    repoName,
  }).then(res => res.data || []);

  return pullRequests.map(({number}) => ({number, repoName}));
}

async function initialize() {
  for (const repoName of getRepoNames()) {
    const pullRequests = await getOpenPRs(repoName);

    for (const pullRequest of pullRequests) {
      // since this runs on startup, if it already has a cached partner,
      // we can assume it's already been synced; it's because of this
      // mechanism that this runs serially instead of in parallel
      if (cache.get(`partner-prs.${generateKeyFromPR(pullRequest)}`)) continue;

      try {
        await syncPR(pullRequest);
      } catch (error) {
        console.error(
          `error syncing ${pullRequest.repoName}#${pullRequest.number}:`,
        );
        console.error(error);
      }
    }
  }
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

    const pullRequests = await getOpenPRs(payload.repository.full_name);

    return Promise.all(
      pullRequests.map(pullRequest => syncPR(pullRequest, ['statuses'])),
    );
  });

  app.on('status', async ({payload}) => {
    const isInMaster = payload.branches.some(
      branch => branch.name === 'master',
    );

    if (isInMaster || isSyncStatusContext(payload.context)) return;

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
