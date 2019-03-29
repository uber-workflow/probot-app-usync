/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const Queue = require('p-queue');
const PRUtils = require('./PRUtils.js');
const {parseRelationshipStr} = require('./utils.js');

// TODO: add more queues where necessary
const QUEUES = {
  syncPR: new Queue({concurrency: 1}),
  syncStatus: new Queue({concurrency: 1}),
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
    let PRToChange;

    if (isParent) {
      PRToChange = await utils.getChildPR(PR, includeClosed);
    } else {
      PRToChange = await utils.getParentPR(PR, includeClosed);
    }

    if (PRToChange) {
      if (payload.action === 'closed' && !payload.pull_request.merged) {
        await utils.closePR(PRToChange);
      } else if (payload.action === 'reopened') {
        await utils.reopenPR(PRToChange);
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
    const PR = await utils.getPRFromPushEvent(payload);
    const promises = [];

    if (PR) {
      if (relationshipConfig.parent) {
        const childPR = PR;
        const parentPR = await utils.getParentPR(childPR);

        if (parentPR) {
          promises.push(
            QUEUES.syncPR.add(() =>
              utils.syncParentPR(payload, childPR, parentPR),
            ),
          );
        }
      }

      if (relationshipConfig.children) {
        const parentPR = PR;
        const childPR = await utils.getChildPR(parentPR);

        if (childPR) {
          promises.push(
            QUEUES.syncPR.add(() =>
              utils.syncChildPR(payload, parentPR, childPR),
            ),
          );
        }
      }
    }

    if (promises.length) await Promise.all(promises);
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
          await QUEUES.syncStatus.add(() =>
            utils.syncPRStatus(childPR, parentPR, 'child-monorepo/ci'),
          );
        }
      }

      if (relationshipConfig.children) {
        const parentPR = PR;
        const childPR = await utils.getChildPR(parentPR);

        if (childPR) {
          await QUEUES.syncStatus.add(() =>
            utils.syncPRStatus(parentPR, childPR, 'parent-monorepo/ci'),
          );
        }
      }
    }
  }
};
