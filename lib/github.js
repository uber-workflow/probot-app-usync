/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import octokitGraphqlWithDefaults from '@octokit/graphql/lib/with-defaults';
import Octokit from '@octokit/rest';

let GITHUB_ID;
const github = new Octokit({
  auth: `token ${process.env.GH_TOKEN}`,
});

// mimics probot's `context.github`
// https://github.com/probot/probot/blob/9265609/src/github/graphql.ts
github.graphql = octokitGraphqlWithDefaults(github.request, {
  method: 'POST',
  url: '/graphql',
});

// shared client with access to all the repos
export default github;
export const request = github.request;

export async function getGithubId() {
  if (!GITHUB_ID) {
    GITHUB_ID = await request('GET /user').then(res => res.data.id);
  }

  return GITHUB_ID;
}
