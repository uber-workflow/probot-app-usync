/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import flatten from 'just-flatten-it';
import octokitGraphqlWithDefaults from '@octokit/graphql/lib/with-defaults';
import Octokit from '@octokit/rest';

const INSTALL_IDS_TO_CLIENTS = new Map();
const REPO_NAMES_TO_INSTALL_IDS = new Map();
let GITHUB_ID;
// shared client with access to all the repos; whereas a github app only has access
// to the repos it's installed on. this app works across github orgs, so needs
// the shared client to access repos its deployment isn't installed on
const sharedGithubClient = new Octokit({
  auth: `token ${process.env.GH_TOKEN}`,
});
// mimics probot's `context.github`
// https://github.com/probot/probot/blob/9265609/src/github/graphql.ts
sharedGithubClient.graphql = octokitGraphqlWithDefaults(
  sharedGithubClient.request,
  {
    method: 'POST',
    url: '/graphql',
  },
);

export default sharedGithubClient;

// dynamically chooses which authenticated github client to
// use based on the repo name being requested. the net result of
// this is essentially tripling the github api usage limit
// (since we deploy this probot in 2 separate deployments for each
// org it runs in; 2 app tokens + 1 common shared token = 3x usage limit)
function getClientForRepoName(repoName) {
  let client = sharedGithubClient;

  if (REPO_NAMES_TO_INSTALL_IDS.has(repoName)) {
    const installId = REPO_NAMES_TO_INSTALL_IDS.get(repoName);

    if (INSTALL_IDS_TO_CLIENTS.has(installId)) {
      client = INSTALL_IDS_TO_CLIENTS.get(installId);
    }
  }

  return client;
}

// similar to the graphql wrapper below, but only uses the
// app-authenticated client for GET requests
export async function request(...args) {
  const requestString = args[0] || '';
  let client = sharedGithubClient;

  if (requestString.startsWith('GET ')) {
    const props = args[1] || {};

    // this mechanism is dependent on the `repoName` placeholder prop
    // being used to identify the repo in the request
    client = getClientForRepoName(props.repoName);
  }

  return client.request(...args);
}

export async function graphql(...args) {
  const props = args[1] || {};
  // this mechanism is dependent on these variable names
  // being used to identify the repo in the graphql query
  const repoName = props.owner && props.repo && `${props.owner}/${props.repo}`;

  return getClientForRepoName(repoName).graphql(...args);
}

export function saveAppGithubClient(context) {
  const {payload} = context;
  const installId = get(payload, 'installation.id');

  if (installId) {
    const repoName = get(payload, 'repository.full_name');

    if (!INSTALL_IDS_TO_CLIENTS.has(installId)) {
      INSTALL_IDS_TO_CLIENTS.set(installId, context.github);
    }

    if (repoName && !REPO_NAMES_TO_INSTALL_IDS.has(repoName)) {
      REPO_NAMES_TO_INSTALL_IDS.set(repoName, installId);
    }
  }
}

export async function getProbotRepoNames(probot) {
  const github = await probot.auth();
  const repoLists = await github
    .request('GET /app/installations')
    .then(res => res.data.map(install => install.id))
    .then(ids =>
      Promise.all(
        ids.map(async id => {
          const token = await probot.app.getInstallationAccessToken({
            installationId: id,
          });
          const github = new Octokit({
            auth: `token ${token}`,
          });

          return github
            .request('GET /installation/repositories', {
              headers: {
                accept: 'application/vnd.github.machine-man-preview+json',
              },
            })
            .then(res =>
              (get(res, 'data.repositories') || []).map(repo => repo.full_name),
            );
        }),
      ),
    );

  return [...new Set(flatten(repoLists))];
}

// gets the github Id of the shared authenticated user
// (i.e. the one that will be making changes to repos)
export async function getGithubId() {
  if (!GITHUB_ID) {
    GITHUB_ID = await sharedGithubClient
      .request('GET /user')
      .then(res => res.data.id);
  }

  return GITHUB_ID;
}
