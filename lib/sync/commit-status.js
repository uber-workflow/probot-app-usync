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
 *
 * @typedef {'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN'} MergeableStateType
 */

/**
 * @typedef {{
 *   branchState: 'ahead' | 'behind',
 *   latestCommitSha: string,
 *   mergeable: MergeableStateType,
 *   statuses: CommitStatusType[],
 * }} PRInfoType
 */
/**
 * @param {PROptType} pullRequest
 * @returns {Promise<PRInfoType>}
 */
async function getPRInfo(pullRequest) {
  const {repoName} = pullRequest;
  const res = await getPRFromNumber(
    `{
      baseRefName
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
      headRefName
      headRepositoryOwner {login}
      isCrossRepository
      mergeable
    }`,
    pullRequest,
    'repository.pullRequest',
  );
  const {
    baseRefName,
    headRefName,
    headRepositoryOwner,
    isCrossRepository,
    mergeable,
  } = res;
  const latestCommit = get(res, 'commits.nodes.0.commit');
  const branchState = await request(
    'GET /repos/:repoName/compare/:baseRef...:headRef',
    {
      repoName,
      baseRef: baseRefName,
      headRef: isCrossRepository
        ? `${headRepositoryOwner.login}:${headRefName}`
        : headRefName,
    },
  ).then(res => res.data.status);

  return {
    branchState,
    latestCommitSha: latestCommit.oid,
    mergeable,
    statuses: get(latestCommit, 'status.contexts') || [],
  };
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
 * Finds sync status from array of statuses
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
 * @param {PRInfoType} prInfo
 * @returns {CommitStatusStateType}
 */
export function getGroupedState(prInfo) {
  const {branchState, mergeable, statuses} = prInfo;
  const states = new Set(
    filterSyncStatus(statuses).map(status => status.state),
  );
  let result;

  if (
    states.has('ERROR') ||
    // TODO: add description to status explaining why it's an error
    mergeable !== 'MERGEABLE' ||
    branchState !== 'ahead'
  ) {
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
  const [primaryInfo, secondaryInfo] = await Promise.all([
    getPRInfo(primaryPR),
    getPRInfo(secondaryPR),
  ]);

  await parallel([
    // sync primary pr
    async () => {
      const groupedState = getGroupedState(secondaryInfo);
      const currentState = getSyncState(primaryInfo.statuses);

      if (currentState !== groupedState.toUpperCase()) {
        return request('POST /repos/:repoName/statuses/:sha', {
          repoName: primaryPR.repoName,
          sha: primaryInfo.latestCommitSha,
          data: {
            context: 'probot/monorepo-sync/secondary-pr',
            state: groupedState,
          },
        });
      }
    },
    // sync secondary pr
    async () => {
      const groupedState = getGroupedState(primaryInfo);
      const currentState = getSyncState(secondaryInfo.statuses);

      if (currentState !== groupedState.toUpperCase()) {
        return request('POST /repos/:repoName/statuses/:sha', {
          repoName: secondaryPR.repoName,
          sha: secondaryInfo.latestCommitSha,
          data: {
            context: 'probot/monorepo-sync/primary-pr',
            state: groupedState,
          },
        });
      }
    },
  ]);
}
