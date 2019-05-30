/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import {request} from '../github.js';
import {getPRFromNumber} from '../graphql.js';
import {parallel} from '../utils.js';

/**
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 *
 * @typedef {{
 *   context: string,
 *   description: string,
 *   state: 'ERROR' | 'EXPECTED' | 'FAILURE' | 'PENDING' | 'SUCCESS',
 * }} CommitStatusType
 *
 * these aren't uppercase because github v3 api uses lowercase,
 * while v4 graphql api uses uppercase
 * @typedef {'error' | 'pending' | 'failure' | 'success'} CommitStatusStateType
 */

/**
 * @param {PROptType} pullRequest
 * @returns {Promise<CommitStatusType[]>}
 */
async function getLatestCommit(pullRequest) {
  return getPRFromNumber(
    `{
      commits(last: 1) {
        nodes {
          commit {
            oid
            status {
              contexts {context, description, state}
            }
          }
        }
      }
    }`,
    pullRequest,
    'repository.pullRequest.commits.nodes.0.commit',
  ).then(commit => ({
    sha: commit.oid,
    statuses: get(commit, 'status.contexts') || [],
  }));
}

/**
 * @param {string} context
 * @returns {boolean}
 */
export function isSyncStatusContext(context) {
  return /^probot\/monorepo-sync\/(primary|secondary)-pr/.test(context);
}

/**
 * Removes sync status from array of statuses
 * @param {CommitStatusType[]} statuses
 * @returns {CommitStatusType[]}
 */
function filterSyncStatus(statuses) {
  return statuses.filter(status => !isSyncStatusContext(status.context));
}

/**
 * Removes sync status from array of statuses
 * @param {CommitStatusType[]} statuses
 * @returns {CommitStatusStateType | void}
 */
function getSyncState(statuses) {
  const syncStatus = statuses.find(status =>
    isSyncStatusContext(status.context),
  );

  if (syncStatus) {
    return syncStatus.state;
  }
}

/**
 * @param {CommitStatusType[]} statuses
 * @returns {CommitStatusStateType}
 */
function getGroupedState(statuses) {
  const states = new Set(
    filterSyncStatus(statuses).map(status => status.state),
  );
  let result;

  if (states.has('ERROR')) {
    result = 'error';
  } else if (states.has('FAILURE')) {
    result = 'failure';
  } else if (states.has('EXPECTED') || states.has('PENDING')) {
    result = 'pending';
  } else {
    result = 'success';
  }

  return result;
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<void>}
 */
export async function syncStatuses(primaryPR, secondaryPR) {
  const [
    {sha: primarySha, statuses: primaryStatuses},
    {sha: secondarySha, statuses: secondaryStatuses},
  ] = await Promise.all([
    getLatestCommit(primaryPR),
    getLatestCommit(secondaryPR),
  ]);

  await parallel([
    // sync primary pr
    async () => {
      if (filterSyncStatus(secondaryStatuses).length) {
        const groupedState = getGroupedState(secondaryStatuses);
        const currentState = getSyncState(primaryStatuses);

        if (currentState !== groupedState.toUpperCase()) {
          return request('POST /repos/:repoName/statuses/:sha', {
            repoName: primaryPR.repoName,
            sha: primarySha,
            data: {
              context: 'probot/monorepo-sync/secondary-pr',
              state: groupedState,
            },
          });
        }
      }
    },
    // sync secondary pr
    async () => {
      if (filterSyncStatus(primaryStatuses).length) {
        const groupedState = getGroupedState(primaryStatuses);
        const currentState = getSyncState(secondaryStatuses);

        if (currentState !== groupedState.toUpperCase()) {
          return request('POST /repos/:repoName/statuses/:sha', {
            repoName: secondaryPR.repoName,
            sha: secondarySha,
            data: {
              context: 'probot/monorepo-sync/primary-pr',
              state: groupedState,
            },
          });
        }
      }
    },
  ]);
}
