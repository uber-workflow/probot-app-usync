/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const PRUtils = require('./PRUtils.js');
const {
  hasChildren,
  hasParent,
  hasRelationship,
} = require('./relationship-utils.js');
const {queue} = require('./utils.js');

const STATUS_CONTEXTS = {
  child: 'child-monorepo/ci',
  parent: 'parent-monorepo/ci',
};

module.exports = app => {
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

    const utils = new PRUtils();
    const PR = await utils.getPRFromChecksPayload(payload);

    if (PR) {
      const statusContext =
        STATUS_CONTEXTS[hasParent(repoName) ? 'parent' : 'child'];

      await queue(utils.genQueueKey(PR, 'status'), () =>
        utils.createPlaceholderStatus(PR, statusContext),
      );
    }
  }

  // create parent PR for child PR
  async function onPullRequestOpen({payload}) {
    if (!hasParent(payload.repository.full_name)) {
      return;
    }

    const utils = new PRUtils();

    // TODO: should this assume parent PR doesn't exist?
    await utils.createParentPR(payload.pull_request);
  }

  // when parent or child PR is closed/reopened, close/reopen the other
  async function onPullRequestStateChange({payload}) {
    if (
      payload.pull_request.merged ||
      !hasRelationship(payload.repository.full_name)
    ) {
      return;
    }

    const utils = new PRUtils();
    const includeClosed = payload.action === 'reopened';
    const partnerPR = await utils.getPartnerPR(
      payload.pull_request,
      includeClosed,
    );

    if (partnerPR) {
      await queue(utils.genQueueKey(partnerPR, 'state-change'), () => {
        switch (payload.action) {
          case 'closed':
            return utils.closePR(partnerPR);
          case 'reopened':
            return utils.reopenPR(partnerPR);
        }
      });
    }
  }

  // child PR commits -> parent PR
  // parent PR commits (to child files) -> child PR
  async function onPush({payload}) {
    const repoName = payload.repository.full_name;
    const utils = new PRUtils();

    if (
      !hasRelationship(repoName) ||
      !utils.pushPayloadHasCopyableCommits(payload)
    ) {
      return;
    }

    const PR = await utils.getPRFromPushPayload(payload);

    if (PR) {
      const partnerPR = await utils.getPartnerPR(PR);

      if (partnerPR) {
        await queue(utils.genQueueKey(partnerPR, 'push'), () => {
          if (hasParent(repoName)) {
            utils.syncParentPR(payload, PR, partnerPR);
          } else {
            utils.syncChildPR(payload, PR, partnerPR);
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

    const utils = new PRUtils();
    const partnerPR = await utils.getPartnerPR(PR);

    if (partnerPR) {
      await queue(utils.genQueueKey(partnerPR, 'merge'), () =>
        utils.mergePR(partnerPR),
      );
    } else if (hasChildren(repoName)) {
      await utils.syncChildRepos(PR);
    }
  }

  // grouped parent PR status -> child PR
  // grouped child PR status -> parent PR
  async function onCommitStatusChange({payload}) {
    const repoName = payload.repository.full_name;

    if (!hasRelationship(repoName)) {
      return;
    }

    const utils = new PRUtils();
    const PR = await utils.getPRFromStatusPayload(payload);

    if (PR) {
      const partnerPR = await utils.getPartnerPR(PR);

      if (partnerPR) {
        const statusContext =
          STATUS_CONTEXTS[hasParent(repoName) ? 'child' : 'parent'];

        await queue(utils.genQueueKey(partnerPR, 'status'), () =>
          utils.syncPRStatus(PR, partnerPR, statusContext),
        );
      }
    }
  }
};
