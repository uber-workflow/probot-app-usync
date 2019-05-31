/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import {request} from '../github.js';
import {getPRFromNumber} from '../graphql.js';

/**
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 *
 * @typedef {'CLOSED' | 'MERGED' | 'OPEN'} PRStateType
 */

/**
 * @param {PROptType} pullRequest
 * @param {PROptType} partnerPR
 * @returns {Promise<void>}
 */
// mostly duplicated logic from uber-workflow/probot-app-merge-pr
export async function merge(pullRequest, partnerPR) {
  const {number, repoName} = pullRequest;
  const [pullRequestInfo, partnerMergeCommitSha] = await Promise.all([
    getPRFromNumber(
      `{
        author {login}
        commits(first: 100) {
          nodes {
            commit {
              author {
                email
                name
                user {login}
              }
            }
          }
        }
        title
        url
      }`,
      pullRequest,
      'repository.pullRequest',
    ),
    getPRFromNumber(
      '{mergeCommit {oid}}',
      partnerPR,
      'repository.pullRequest.mergeCommit.oid',
    ),
  ]);
  const authorTrailers = (get(pullRequestInfo, 'commits.nodes') || []).reduce(
    (result, commit) => {
      const {email, name, user} = commit.commit.author;

      if (user.login !== pullRequestInfo.author.login) {
        result.add(`Co-authored-by: ${name} <${email}>`);
      }

      return result;
    },
    new Set(),
  );
  let commit_message = `${
    pullRequestInfo.url
  }\n\nmeta:sha:${partnerMergeCommitSha}`;

  if (authorTrailers.size) {
    commit_message += '\n\n' + [...authorTrailers].join('\n');
  }

  await request(`PUT /repos/:repoName/pulls/:number/merge`, {
    number,
    repoName,
    data: {
      commit_message,
      commit_title: `${pullRequestInfo.title} (#${number})`,
      merge_method: 'squash',
    },
  });
}

/**
 * @param {PROptType} pullRequest
 * @returns {Promise<{
 *   closedAt: string | void,
 *   mergeable: 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN',
 *   state: PRStateType,
 *   updatedAt: string | void,
 * }>}
 */
async function getInfo(pullRequest) {
  return getPRFromNumber(
    '{closedAt, mergeable, state, updatedAt}',
    pullRequest,
    'repository.pullRequest',
  );
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<PRStateType>} resulting state
 */
export async function syncState(primaryPR, secondaryPR) {
  const [primaryInfo, secondaryInfo] = await Promise.all([
    getInfo(primaryPR),
    getInfo(secondaryPR),
  ]);
  let result;

  // TODO: close/re-open depending on whether a parent repo pr currently contains changes to child repo files; also should NOT sync merge if child pr is closed because of this

  // this code is pretty ugly, is there a better way to write it?
  if (primaryInfo.state !== secondaryInfo.state) {
    const states = [primaryInfo.state, secondaryInfo.state];

    if (states.includes('MERGED')) {
      result = 'MERGED';

      if (primaryInfo.state === 'MERGED') {
        await merge(secondaryPR, primaryPR);
      } else {
        await merge(primaryPR, secondaryPR);
      }
    } else if (states.includes('CLOSED')) {
      const primaryIsClosed = primaryInfo.state === 'CLOSED';
      const closedPRInfo = primaryIsClosed ? primaryInfo : secondaryInfo;
      const openPRInfo = primaryIsClosed ? secondaryInfo : primaryInfo;
      const newState =
        closedPRInfo.closedAt > openPRInfo.updatedAt ? 'CLOSED' : 'OPEN';
      const prToChange =
        primaryInfo.state === newState ? secondaryPR : primaryPR;

      result = newState;
      await request('PATCH /repos/:repoName/pulls/:number', {
        number: prToChange.number,
        repoName: prToChange.repoName,
        data: {
          state: newState.toLowerCase(),
        },
      });
    }
  } else {
    result = primaryInfo.state;
  }

  return result;
}
