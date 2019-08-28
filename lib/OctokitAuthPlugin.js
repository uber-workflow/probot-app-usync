/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {App} = require('@octokit/app');
const {endpoint: createEndpoint} = require('@octokit/endpoint');
const {request} = require('@octokit/request');
const get = require('just-safe-get');

const GH_HOST = 'https://api.github.com';
const {APP_ID, GH_TOKEN, PRIVATE_KEY} = process.env;
const REPO_INSTALL_IDS = new Map();
const app = new App({
  id: APP_ID,
  privateKey: PRIVATE_KEY,
});

/**
 * @type {import('@octokit/rest').Plugin}
 */
module.exports = function OctokitAuthPlugin(octokit) {
  octokit.hook.wrap('request', async (request, options) => {
    const token = await getAuthToken(createEndpoint(options));

    options.headers.authorization = `token ${token}`;
    return request(options);
  });
};

/**
 * if the request is tied to a repo, use a token from the app's
 * installation; otherwise fallback to the github user token (GH_TOKEN)
 *
 * @param {import('@octokit/rest').RequestOptions} endpoint
 * @return {string}
 */
async function getAuthToken(endpoint) {
  const resolvedUrl = endpoint.url.replace(GH_HOST, '');
  let repoName;

  if (resolvedUrl === '/graphql') {
    const {owner, repo} = get(endpoint, 'body.variables') || {};

    if (owner && repo) {
      repoName = [owner, repo].join('/');
    }
  } else {
    const match = /^\/repos\/([a-z-]+\/[a-z-.]+)/.exec(resolvedUrl);

    if (match) {
      repoName = match[1];
    }
  }

  if (repoName) {
    return app.getInstallationAccessToken({
      installationId: await getRepoInstallID(repoName),
    });
  }

  return GH_TOKEN;
}

/**
 * @param {string} repoName
 * @returns {number}
 */
async function getRepoInstallID(repoName) {
  if (REPO_INSTALL_IDS.has(repoName)) {
    return REPO_INSTALL_IDS.get(repoName);
  } else {
    const {
      data: {id},
    } = await request('GET /repos/:repoName/installation', {
      repoName,
      headers: {
        authorization: `Bearer ${app.getSignedJsonWebToken()}`,
        accept: 'application/vnd.github.machine-man-preview+json',
      },
    });

    REPO_INSTALL_IDS.set(repoName, id);
    return id;
  }
}
