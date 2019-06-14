/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {authedRequest} from './utils.js';

export {getGithubId} from './utils.js';

export async function request(url, props = {}) {
  let repoName;

  // tries to get repo name from url placeholders
  // e.g. `GET /repos/:owner/:repo`
  if (props.repoName) {
    repoName = props.repoName;
  } else if (props.owner && props.repo) {
    repoName = [props.owner, props.repo].join('/');
  }

  return authedRequest(url, props, repoName).catch(error => {
    let {authType, message} = error;

    error.message = `REST (auth type: ${authType ||
      'unknown'}): ${message}\n\nurl: ${
      error.requestUrl
    }\nprops: ${JSON.stringify(error.requestProps, null, 2)}`;
    throw error;
  });
}

export async function graphql(query, vars = {}) {
  // tries to get repo name from graphql variables
  const repoName = vars.owner && vars.repo && `${vars.owner}/${vars.repo}`;

  return authedRequest(
    'POST /graphql',
    {
      data: {
        query,
        variables: vars,
      },
    },
    repoName,
  )
    .then(res => res.data)
    .then(res => {
      if (res.errors) {
        throw new Error(res.errors[0].message);
      }

      return res.data;
    })
    .catch(error => {
      let {authType, message} = error;

      error.message = `GraphQL (auth type: ${authType ||
        'unknown'}): ${message}\n\nurl: ${
        error.requestUrl
      }\nprops: ${JSON.stringify(error.requestProps, null, 2)}`;
      throw error;
    });
}
