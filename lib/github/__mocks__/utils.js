/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Octokit from '@octokit/rest';
const octokit = new Octokit();

export async function authedRequest(url, props) {
  return octokit.request(url, props).catch(error => {
    Object.assign(error, {
      authType: 'mocked',
      requestProps: props,
      requestUrl: url,
    });

    throw error;
  });
}

export async function getGithubId() {
  return 0;
}
