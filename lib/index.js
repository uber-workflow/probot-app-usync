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
      if (hasParent(repoName)) {
        queue(utils.genQueueKey(PR, 'status'), () =>
          utils.createPlaceholderStatus(PR, STATUS_CONTEXTS.parent),
        );
      }

      if (hasChildren(repoName)) {
        queue(utils.genQueueKey(PR, 'status'), () =>
          utils.createPlaceholderStatus(PR, STATUS_CONTEXTS.child),
        );
      }
    }
  }

  // create parent PR for child PR
  async function onPullRequestOpen({github, payload}) {
    if (!hasParent(payload.repository.full_name)) {
      return;
    }

    const childPR = payload.pull_request;
    const utils = new PRUtils(github);

    // TODO: should this assume parent PR doesn't exist?
    await utils.createParentPR(childPR);
  }

  // when parent or child PR is closed/reopened, close/reopen the other
  async function onPullRequestStateChange({github, payload}) {
    const repoName = payload.repository.full_name;

    if (payload.pull_request.merged || !hasRelationship(repoName)) {
      return;
    }

    const PR = payload.pull_request;
    const utils = new PRUtils(github);
    const includeClosed = payload.action === 'reopened';
    let PRToUpdate;

    if (hasChildren(repoName)) {
      PRToUpdate = await utils.getChildPR(PR, includeClosed);
    } else {
      PRToUpdate = await utils.getParentPR(PR, includeClosed);
    }

    if (PRToUpdate) {
      if (payload.action === 'closed') {
        await utils.closePR(PRToUpdate);
      } else if (payload.action === 'reopened') {
        await utils.reopenPR(PRToUpdate);
      }
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
      if (hasParent(repoName)) {
        const childPR = PR;
        const parentPR = await utils.getParentPR(childPR);

        if (parentPR) {
          queue(utils.genQueueKey(parentPR, 'push'), () =>
            utils.syncParentPR(payload, childPR, parentPR),
          );
        }
      }

      if (hasChildren(repoName)) {
        const parentPR = PR;
        const childPR = await utils.getChildPR(parentPR);

        if (childPR) {
          queue(utils.genQueueKey(childPR, 'push'), () =>
            utils.syncChildPR(payload, parentPR, childPR),
          );
        }
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
    const promises = [];

    if (partnerPR) {
      const key = utils.genQueueKey(partnerPR, 'merge');

      queue(key, () => utils.mergePR(partnerPR));
      promises.push(onQueueIdle(key));
    }

    if (hasChildren(repoName) && !utils.isAutoSyncPR(PR)) {
      promises.push(utils.syncChildRepos(PR));
    }

    await Promise.all(promises);
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
      if (hasParent(repoName)) {
        const childPR = PR;
        const parentPR = await utils.getParentPR(childPR);

        if (parentPR) {
          queue(utils.genQueueKey(parentPR, 'status'), () =>
            utils.syncPRStatus(childPR, parentPR, STATUS_CONTEXTS.child),
          );
        }
      }

      if (hasChildren(repoName)) {
        const parentPR = PR;
        const childPR = await utils.getChildPR(parentPR);

        if (childPR) {
          queue(utils.genQueueKey(childPR, 'status'), () =>
            utils.syncPRStatus(parentPR, childPR, STATUS_CONTEXTS.parent),
          );
        }
      }
    }
  }
};
