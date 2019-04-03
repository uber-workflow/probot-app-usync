/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const PRUtils = require('./PRUtils.js');
const {parseRelationshipStr, queue} = require('./utils.js');

const STATUS_CONTEXTS = {
  child: 'child-monorepo/ci',
  parent: 'parent-monorepo/ci',
};
// e.g.
// REPO_RELATIONSHIP_MAP.get('fusionjs/parent').children[0].name
// REPO_RELATIONSHIP_MAP.get('fusionjs/parent').children[0].path
// REPO_RELATIONSHIP_MAP.get('fusionjs/child').parent
const REPO_RELATIONSHIP_MAP = parseRelationshipStr(
  process.env.REPO_RELATIONSHIPS,
);

if (!REPO_RELATIONSHIP_MAP.size) {
  // eslint-disable-next-line no-console
  console.warn('No repo relationships configured!');
}

module.exports = app => {
  app.on(
    ['pull_request.closed', 'pull_request.reopened'],
    onPullRequestStateChange,
  );
  app.on('pull_request.closed', onPullRequestMerge);
  app.on('pull_request.opened', onPullRequestOpen);
  app.on('push', onPush);
  app.on('status', onCommitStatusChange);

  // create parent PR for child PR
  async function onPullRequestOpen(context) {
    const {github, payload} = context;
    const relationshipConfig = REPO_RELATIONSHIP_MAP.get(
      payload.repository.full_name,
    );

    if (!relationshipConfig || !relationshipConfig.parent) {
      return;
    }

    const childPR = payload.pull_request;
    const utils = new PRUtils(github, REPO_RELATIONSHIP_MAP);

    // TODO: should this assume parent PR doesn't exist?
    await utils.createParentPR(childPR);
  }

  // when parent or child PR is closed/reopened, close/reopen the other
  async function onPullRequestStateChange(context) {
    const {github, payload} = context;
    const relationshipConfig = REPO_RELATIONSHIP_MAP.get(
      payload.repository.full_name,
    );

    if (!relationshipConfig) {
      return;
    }

    const PR = payload.pull_request;
    const utils = new PRUtils(github, REPO_RELATIONSHIP_MAP);
    const isParent = !!relationshipConfig.children;
    const includeClosed = payload.action === 'reopened';
    let PRToUpdate;

    if (isParent) {
      PRToUpdate = await utils.getChildPR(PR, includeClosed);
    } else {
      PRToUpdate = await utils.getParentPR(PR, includeClosed);
    }

    if (PRToUpdate) {
      if (payload.action === 'closed' && !payload.pull_request.merged) {
        await utils.closePR(PRToUpdate);
      } else if (payload.action === 'reopened') {
        await utils.reopenPR(PRToUpdate);
      }
    }
  }

  // child PR commits -> parent PR
  // parent PR commits (to child files) -> child PR
  async function onPush(context) {
    const {github, payload} = context;
    const relationshipConfig = REPO_RELATIONSHIP_MAP.get(
      payload.repository.full_name,
    );

    if (!relationshipConfig) {
      return;
    }

    const utils = new PRUtils(github, REPO_RELATIONSHIP_MAP);

    if (!utils.pushEventHasCopyableCommits(payload)) {
      return;
    }

    const PR = await utils.getPRFromPushEvent(payload);

    if (PR) {
      if (relationshipConfig.parent) {
        const childPR = PR;
        const parentPR = await utils.getParentPR(childPR);

        if (parentPR) {
          queue(utils.genQueueKey(parentPR, 'push'), () =>
            utils.syncParentPR(payload, childPR, parentPR),
          );
        }
      }

      if (relationshipConfig.children) {
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
  async function onPullRequestMerge(context) {
    const {github, payload} = context;
    const relationshipConfig = REPO_RELATIONSHIP_MAP.get(
      payload.repository.full_name,
    );

    if (
      !payload.pull_request.merged ||
      !relationshipConfig ||
      !relationshipConfig.children
    ) {
      return;
    }

    const parentPR = payload.pull_request;
    const utils = new PRUtils(github, REPO_RELATIONSHIP_MAP);

    if (!utils.isAutoSyncPR(parentPR)) {
      await utils.syncChildRepos(parentPR);
    }
  }

  // grouped parent PR status -> child PR
  // grouped child PR status -> parent PR
  async function onCommitStatusChange(context) {
    const {github, payload} = context;
    const relationshipConfig = REPO_RELATIONSHIP_MAP.get(
      payload.repository.full_name,
    );

    if (!relationshipConfig) {
      return;
    }

    const utils = new PRUtils(github, REPO_RELATIONSHIP_MAP);
    const PR = await utils.getPRFromStatusEvent(payload);

    if (PR) {
      if (relationshipConfig.parent) {
        const childPR = PR;
        const parentPR = await utils.getParentPR(childPR);

        if (parentPR) {
          queue(utils.genQueueKey(parentPR, 'status'), () =>
            utils.syncPRStatus(childPR, parentPR, STATUS_CONTEXTS.child),
          );
        }
      }

      if (relationshipConfig.children) {
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
