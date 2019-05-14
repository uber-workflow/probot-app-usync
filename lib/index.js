/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  closePR,
  createParentPR,
  createPlaceholderStatus,
  genQueueKey,
  getPartnerPR,
  getPRFromChecksPayload,
  getPRFromPushPayload,
  getPRFromStatusPayload,
  mergePR,
  pushPayloadHasCopyableCommits,
  reopenPR,
  syncChildPR,
  syncChildRepos,
  syncParentPR,
  syncPRStatus,
} from './pr-utils.js';
import {hasChildren, hasParent, hasRelationship} from './relationship-utils.js';
import {queue} from './utils.js';

const STATUS_CONTEXTS = {
  child: 'child-monorepo/ci',
  parent: 'parent-monorepo/ci',
};

export default function(app) {
  app.on('check_suite.requested', onCheckSuiteRequested);
  app.on(
    ['pull_request.closed', 'pull_request.reopened'],
    onPullRequestStateChange,
  );
  app.on('pull_request.closed', onPullRequestMerge);
  app.on('pull_request.opened', onPullRequestOpen);
  app.on('push', onPush);
  app.on('status', onCommitStatusChange);

  // add placeholder parent/child PR status to prevent merging during
  // sync delay
  async function onCheckSuiteRequested({payload}) {
    const repoName = payload.repository.full_name;

    if (!hasRelationship(repoName)) {
      return;
    }

    const PR = await getPRFromChecksPayload(payload);

    if (PR) {
      const statusContext =
        STATUS_CONTEXTS[hasParent(repoName) ? 'parent' : 'child'];

      await queue(genQueueKey(PR, 'status'), () =>
        createPlaceholderStatus(PR, statusContext),
      );
    }
  }

  // create parent PR for child PR
  async function onPullRequestOpen({payload}) {
    if (!hasParent(payload.repository.full_name)) {
      return;
    }

    // TODO: should this assume parent PR doesn't exist?
    await createParentPR(payload.pull_request);
  }

  // when parent or child PR is closed/reopened, close/reopen the other
  async function onPullRequestStateChange({payload}) {
    if (
      payload.pull_request.merged ||
      !hasRelationship(payload.repository.full_name)
    ) {
      return;
    }

    const includeClosed = payload.action === 'reopened';
    const partnerPR = await getPartnerPR(payload.pull_request, includeClosed);

    if (partnerPR) {
      await queue(genQueueKey(partnerPR, 'state-change'), () => {
        switch (payload.action) {
          case 'closed':
            return closePR(partnerPR);
          case 'reopened':
            return reopenPR(partnerPR);
        }
      });
    }
  }

  // child PR commits -> parent PR
  // parent PR commits (to child files) -> child PR
  async function onPush({payload}) {
    const repoName = payload.repository.full_name;

    if (!hasRelationship(repoName) || !pushPayloadHasCopyableCommits(payload)) {
      return;
    }

    const PR = await getPRFromPushPayload(payload);

    if (PR) {
      const partnerPR = await getPartnerPR(PR);

      if (partnerPR) {
        await queue(genQueueKey(partnerPR, 'push'), () => {
          if (hasParent(repoName)) {
            syncParentPR(payload, PR, partnerPR);
          } else {
            syncChildPR(payload, PR, partnerPR);
          }
        });
      }
    }
  }

  // child changes authored from parent repo -> child repo
  // child PR merges -> merge parent PR
  // parent PR merges -> merge child PR
  async function onPullRequestMerge({payload}) {
    const PR = payload.pull_request;
    const repoName = payload.repository.full_name;

    if (!PR.merged || !hasRelationship(repoName)) {
      return;
    }

    const partnerPR = await getPartnerPR(PR);

    if (partnerPR) {
      await queue(genQueueKey(partnerPR, 'merge'), () => mergePR(partnerPR));
    } else if (hasChildren(repoName)) {
      await syncChildRepos(PR);
    }
  }

  // grouped parent PR status -> child PR
  // grouped child PR status -> parent PR
  async function onCommitStatusChange({payload}) {
    const repoName = payload.repository.full_name;

    if (!hasRelationship(repoName)) {
      return;
    }

    const PR = await getPRFromStatusPayload(payload);

    if (PR) {
      const partnerPR = await getPartnerPR(PR);

      if (partnerPR) {
        const statusContext =
          STATUS_CONTEXTS[hasParent(repoName) ? 'child' : 'parent'];

        await queue(genQueueKey(partnerPR, 'status'), () =>
          syncPRStatus(PR, partnerPR, statusContext),
        );
      }
    }
  }
}
