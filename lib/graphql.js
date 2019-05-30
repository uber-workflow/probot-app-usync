/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import {graphql} from './github.js';

/**
 * @typedef {{
 *   repoName: string,
 * }} BasePropsType
 */

/**
 * @param {query} string
 * @param {object} props
 * @param {string} [path]
 * @returns {Promise<*>}
 */
async function query(query, props, path) {
  // replace `repoName` prop with `owner` and `repo` for convenience
  if (props.repoName) {
    props = {...props};
    const [owner, repo] = props.repoName.split('/');

    delete props.repoName;
    Object.assign(props, {owner, repo});
  }

  return (
    // inject rate limit fields
    graphql(query.replace(/\}$/, ' rateLimit {limit, remaining}}'), props)
      .then(res => {
        if (res.rateLimit) {
          console.log(`remaining graphql points: ${res.rateLimit.remaining}`);
        }

        return res;
      })
      .then(res => (path ? get(res, path) : res))
  );
}

/**
 * @param {string} fields fields to provide to the query
 * @param {BasePropsType} props
 * @param {string} [path] dot-notation path to return from response
 * @returns {Promise<*>}
 */
export function getOpenPRs(fields, props, path) {
  return query(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(first: 100, states: [OPEN]) {
          nodes ${fields}
        }
      }
    }`,
    props,
    path,
  );
}

/**
 * @param {string} fields fields to provide to the query
 * @param {BasePropsType & {
 *   branchName: string,
 *   includeClosed?: boolean,
 * }} props
 * @param {string} [path] dot-notation path to return from response
 * @returns {Promise<*>}
 */
export function getPRsFromBranch(fields, props, path) {
  // `includeClosed` should only be used when 100% positive there's an active
  // partner pr with the provided branch name (i.e. when the partner pr number
  // is in the branch name), otherwise results will likely include old, already-
  // merged branches
  const states = props.includeClosed ? 'CLOSED, MERGED, OPEN' : 'OPEN';

  props = {...props};
  delete props.includeClosed;
  return query(
    `query($owner: String!, $repo: String!, $branchName: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(
          first: 1,
          headRefName: $branchName,
          orderBy: { field: UPDATED_AT, direction: DESC },
          states: [${states}],
        ) {
          nodes ${fields}
        }
      }
    }`,
    props,
    path,
  );
}

/**
 * @param {string} fields fields to provide to the query
 * @param {BasePropsType & {
 *   number: number,
 * }} props
 * @param {string} [path] dot-notation path to return from response
 * @returns {Promise<*>}
 */
export function getPRFromNumber(fields, props, path) {
  return query(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) ${fields}
      }
    }`,
    props,
    path,
  );
}

/**
 * @param {string} fields fields to provide to the query
 * @param {BasePropsType & {
 *   name: string,
 * }} props
 * @param {string} [path] dot-notation path to return from response
 * @returns {Promise<*>}
 */
export function getRef(fields, props, path) {
  props = {...props};
  props.qualifiedName = `refs/heads/${props.name}`;
  delete props.name;

  return query(
    `query($owner: String!, $repo: String!, $qualifiedName: String!) {
      repository(owner: $owner, name: $repo) {
        ref(qualifiedName: $qualifiedName) ${fields}
      }
    }`,
    props,
    path,
  );
}
