/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {syncPR} from './sync/index.js';
import {isSyncStatusContext} from './sync/commit-status.js';
import {getOpenPRs} from './graphql.js';
import {getRepoNames} from './relationships.js';

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

    // TODO:
    // await syncBranch({
    //   branchName: 'master',
    //   repoName,
    // });
  }
}

export default function(app) {
  init().catch(console.error);

  app.on('check_suite.requested', async ({payload}) =>
    syncPR({
      branchName: payload.check_suite.head_branch,
      repoName: payload.repository.full_name,
    }),
  );

  app.on(
    [
      'pull_request.closed',
      'pull_request.edited',
      'pull_request.opened',
      'pull_request.reopened',
      'pull_request.synchronize',
    ],
    async ({payload}) =>
      syncPR({
        number: payload.pull_request.number,
        repoName: payload.repository.full_name,
      }),
  );

  // TODO:
  // app.on('push', async ({payload}) => {
  //   const branchName = payload.ref.replace(/^refs\/heads\//, '');

  //   if (branchName === 'master') {
  //     await syncBranch({
  //       branchName,
  //       repoName: payload.repository.full_name,
  //     });
  //   }
  // });

  app.on('status', async ({payload}) => {
    if (!isSyncStatusContext(payload.context)) {
      return syncPR({
        branchNames: payload.branches,
        repoName: payload.repository.full_name,
      });
    }
  });
}
