/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {App} from '@octokit/app';
import OctokitThrottlePlugin from '@octokit/plugin-throttling';
import Octokit from '@octokit/rest';
import clone from 'just-clone';
import get from 'just-safe-get';
import {hasRelationship} from '../relationships.js';
import OctokitCachePlugin from './plugin-cache.js';

// ref: https://github.com/probot/probot/blob/460e578/src/github/index.ts
const octokit = new (Octokit.plugin([
  OctokitThrottlePlugin,
  OctokitCachePlugin,
]))({
  throttle: {
    onAbuseLimit: retryAfter =>
      console.warn(`Abuse limit hit, retrying in ${retryAfter} seconds`),
    onRateLimit: retryAfter =>
      console.warn(`Rate limit hit, retrying in ${retryAfter} seconds`),
  },
});
const {APP_ID, GH_TOKEN, PRIVATE_KEY} = process.env;
const GITHUB_APP = new App({id: APP_ID, privateKey: PRIVATE_KEY});
let INIT_PROMISE;

/**
 * uses map (repo names -> install ids) to authenticate a request based
 * on the repo name involved. probot does this for you  (context object
 * contains auth'd github client), but since this bot operates between
 * multiple github orgs, this needs to be handled on the fly.
 *
 * injects helpful metadata into thrown exceptions:
 * - error.authType
 * - error.requestProps
 * - error.requestUrl
 */
export async function authedRequest(url, props, repoName) {
  const {repoNamesToInstallIDs} = await initialize();
  let authType = 'custom';

  if (!get(props, 'headers.authorization')) {
    let authorization;

    // if we can, authenticate with the github app for requests used
    // for getting data; fallback to github user account. also use
    // github user account for modification requests (DELETE, PATCH, POST)
    // due to limitations of github app accounts (e.g. can't reference
    // PRs/issues from comments)
    if (
      url === 'POST /graphql' &&
      repoName &&
      repoNamesToInstallIDs.has(repoName)
    ) {
      const token = await GITHUB_APP.getInstallationAccessToken({
        installationId: repoNamesToInstallIDs.get(repoName),
      });

      authorization = `token ${token}`;
      authType = 'app';
    } else {
      authorization = `token ${GH_TOKEN}`;
      authType = 'user';
    }

    props.headers = {
      ...props.headers,
      authorization,
    };
  }

  return octokit.request(url, props).catch(error => {
    const requestProps = clone(props);

    if (get(requestProps, 'headers.authorization')) {
      requestProps.headers.authorization = '[redacted]';
    }

    Object.assign(error, {
      authType,
      requestProps,
      requestUrl: url,
    });

    throw error;
  });
}

export async function getGithubId() {
  const {githubUserID} = await initialize();
  return githubUserID;
}

/**
 * wrapper for actual initializer; caches returned promise
 * @returns {InitReturn}
 */
export async function initialize() {
  if (!INIT_PROMISE) {
    INIT_PROMISE = _initialize().catch(console.error);
  }

  return INIT_PROMISE;
}

/**
 * @typedef {Promise<{
 *   githubUserID: number,
 *   repoNamesToInstallIDs: Map<string, number>,
 * }>} InitReturn
 */
/**
 * gets app installations and populates:
 * - repo/install map
 * - github user id
 * @returns {InitReturn}
 */
async function _initialize() {
  const bearer = GITHUB_APP.getSignedJsonWebToken();
  const installs = await octokit
    .request('GET /app/installations', {
      headers: {
        accept: 'application/vnd.github.machine-man-preview+json',
        authorization: `bearer ${bearer}`,
      },
    })
    .then(res => res.data);
  const result = {
    githubUserID: null,
    repoNamesToInstallIDs: new Map(),
  };

  await Promise.all(
    installs.map(async (install, index) => {
      const {id: installID} = install;
      const token = await GITHUB_APP.getInstallationAccessToken({
        installationId: installID,
      });

      // use first install to get github user Id of the app
      // - used to filter webhooks based on `sender` field
      if (index === 0) {
        // TODO: currently using an actual user for this instead of github app;
        // use commented lines below once this changes
        result.githubUserID = await octokit
          .request('GET /user', {
            headers: {
              authorization: `token ${GH_TOKEN}`,
            },
          })
          .then(res => res.data.id);
        /* // get github app for name
        const bot = await octokit.request('GET /app', {
          headers: {
            authorization: `bearer ${bearer}`,
          },
        }).then(res => res.data);
        // get github user
        const botUser = await octokit.request('GET /users/:username', {
          // append [bot] to name
          username: `${bot.name}%5Bbot%5D`,
          headers: {
            authorization: `token ${token}`,
          },
        }).then(res => res.data);

        result.githubUserID = botUser.id; */
      }

      const repos = await octokit
        .request('GET /installation/repositories', {
          headers: {
            accept: 'application/vnd.github.machine-man-preview+json',
            authorization: `token ${token}`,
          },
        })
        .then(res => get(res, 'data.repositories') || []);

      for (const repo of repos) {
        const {full_name: repoName} = repo;

        if (hasRelationship(repoName)) {
          result.repoNamesToInstallIDs.set(repoName, installID);
        }
      }
    }),
  );

  return result;
}