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
const {onQueueIdle, queue} = require('./utils.js');

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
  async function onCheckSuiteRequested({github, payload}) {
    const repoName = payload.repository.full_name;

    if (!hasRelationship(repoName)) {
      return;
    }

    const utils = new PRUtils(github);
    const PR = await utils.getPRFromChecksEvent(payload);

    if (PR) {
      const queueKey = utils.genQueueKey(PR, 'status');
      const statusContext =
        STATUS_CONTEXTS[hasParent(repoName) ? 'parent' : 'child'];

      queue(queueKey, () => utils.createPlaceholderStatus(PR, statusContext));
      await onQueueIdle(queueKey);
    }
  }

  // create parent PR for child PR
  async function onPullRequestOpen({github, payload}) {
    if (!hasParent(payload.repository.full_name)) {
      return;
    }

    const utils = new PRUtils(github);

    // TODO: should this assume parent PR doesn't exist?
    await utils.createParentPR(payload.pull_request);
  }

  // when parent or child PR is closed/reopened, close/reopen the other
  async function onPullRequestStateChange({github, payload}) {
    if (
      payload.pull_request.merged ||
      !hasRelationship(payload.repository.full_name)
    ) {
      return;
    }

    const utils = new PRUtils(github);
    const includeClosed = payload.action === 'reopened';
    const partnerPR = await utils.getPartnerPR(
      payload.pull_request,
      includeClosed,
    );

    if (partnerPR) {
      const queueKey = utils.genQueueKey(partnerPR, 'state-change');

      queue(queueKey, () => {
        switch (payload.action) {
          case 'closed':
            return utils.closePR(partnerPR);
          case 'reopened':
            return utils.reopenPR(partnerPR);
        }
      });
      await onQueueIdle(queueKey);
    }
  }

  // child PR commits -> parent PR
  // parent PR commits (to child files) -> child PR
  async function onPush({github, payload}) {
    const repoName = payload.repository.full_name;
    const utils = new PRUtils(github);

    if (
      !hasRelationship(repoName) ||
      !utils.pushEventHasCopyableCommits(payload)
    ) {
      return;
    }

    const PR = await utils.getPRFromPushEvent(payload);

    if (PR) {
      const partnerPR = await utils.getPartnerPR(PR);

      if (partnerPR) {
        const queueKey = utils.genQueueKey(partnerPR, 'push');

        queue(queueKey, () => {
          if (hasParent(repoName)) {
            utils.syncParentPR(payload, PR, partnerPR);
          } else {
            utils.syncChildPR(payload, PR, partnerPR);
          }
        });
        await onQueueIdle(queueKey);
      }
    }
  }

  // child changes authored from parent repo -> child repo
  // child PR merges -> merge parent PR
  // parent PR merges -> merge child PR
  async function onPullRequestMerge({github, payload}) {
    const PR = payload.pull_request;
    const repoName = payload.repository.full_name;

    if (!PR.merged || !hasRelationship(repoName)) {
      return;
    }

    const utils = new PRUtils(github);
    const partnerPR = await utils.getPartnerPR(PR);

    if (partnerPR) {
      const queueKey = utils.genQueueKey(partnerPR, 'merge');

      queue(queueKey, () => utils.mergePR(partnerPR));
      await onQueueIdle(queueKey);
    } else if (hasChildren(repoName)) {
      await utils.syncChildRepos(PR);
    }
  }

  // grouped parent PR status -> child PR
  // grouped child PR status -> parent PR
  async function onCommitStatusChange(context) {
    const {github, payload} = context;
    const repoName = payload.repository.full_name;
    const isSyncStatus = Object.values(STATUS_CONTEXTS).includes(
      payload.context,
    );

    if (!hasRelationship(repoName) || isSyncStatus) {
      return;
    }

    const utils = new PRUtils(github);
    const PR = await utils.getPRFromStatusEvent(payload);

    if (PR) {
      const partnerPR = await utils.getPartnerPR(PR);

      if (partnerPR) {
        const queueKey = utils.genQueueKey(partnerPR, 'status');
        const statusContext =
          STATUS_CONTEXTS[hasParent(repoName) ? 'child' : 'parent'];

        queue(queueKey, () => utils.syncPRStatus(PR, partnerPR, statusContext));
        await onQueueIdle(queueKey);
      }
    }
  }
};
