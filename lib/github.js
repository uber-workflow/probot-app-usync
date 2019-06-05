/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {App} from '@octokit/app';
import {request as githubRequest} from '@octokit/request';
import get from 'just-safe-get';
import {hasRelationship} from './relationships.js';

const {APP_ID, GH_TOKEN, PRIVATE_KEY} = process.env;
const GITHUB_APP = new App({id: APP_ID, privateKey: PRIVATE_KEY});
let INIT_PROMISE;

export async function request(url, props) {
  let repoName;

  // tries to get repo name from url placeholders
  // e.g. `GET /repos/:owner/:repo`
  if (props.repoName) {
    repoName = props.repoName;
  } else if (props.owner && props.repo) {
    repoName = [props.owner, props.repo].join('/');
  }

  return authedRequest(url, props, repoName);
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
        throw new Error(res.errors[0]);
      }

      return res.data;
    });
}

export async function getGithubId() {
  const {githubUserID} = await initialize();
  return githubUserID;
}

// uses map (repo names -> install ids) to authenticate a request based
// on the repo name involved. probot does this for you  (context object
// contains auth'd github client), but since this bot operates between
// multiple github orgs, this needs to be handled on the fly
async function authedRequest(url, props, repoName) {
  const {repoNamesToInstallIDs} = await initialize();

  if (!get(props, 'headers.authorization')) {
    let authorization;

    // TODO: currently using an actual user token (instead of the github app)
    // for all non-GET requests to get around github not supporting short-references
    // to repos, issues, etc. with apps
    if (!url.startsWith('GET') && url !== 'POST /graphql') {
      authorization = `token ${GH_TOKEN}`;
    } else if (repoName) {
      if (repoNamesToInstallIDs.has(repoName)) {
        const token = await GITHUB_APP.getInstallationAccessToken({
          installationId: repoNamesToInstallIDs.get(repoName),
        });

        authorization = `token ${token}`;
      } else {
        throw new Error(`No install id matching repo name: ${repoName}`);
      }
    } else {
      // auth as the github app as fallback
      authorization = `bearer ${GITHUB_APP.getSignedJsonWebToken()}`;
    }

    props.headers = {
      ...props.headers,
      authorization,
    };
  }

  return githubRequest(url, props);
}

/**
 * wrapper for actual initializer; caches returned promise
 * @returns {InitReturn}
 */
async function initialize() {
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
  const installs = await githubRequest('GET /app/installations', {
    headers: {
      accept: 'application/vnd.github.machine-man-preview+json',
      authorization: `bearer ${bearer}`,
    },
  }).then(res => res.data);
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
        result.githubUserID = await githubRequest('GET /user', {
          headers: {
            authorization: `token ${GH_TOKEN}`,
          },
        }).then(res => res.data.id);
        /* // get github app for name
        const bot = await githubRequest('GET /app', {
          headers: {
            authorization: `bearer ${bearer}`,
          },
        }).then(res => res.data);
        // get github user
        const botUser = await githubRequest('GET /users/:username', {
          // append [bot] to name
          username: `${bot.name}%5Bbot%5D`,
          headers: {
            authorization: `token ${token}`,
          },
        }).then(res => res.data);

        result.githubUserID = botUser.id; */
      }

      const repos = await githubRequest('GET /installation/repositories', {
        headers: {
          accept: 'application/vnd.github.machine-man-preview+json',
          authorization: `token ${token}`,
        },
      }).then(res => get(res, 'data.repositories') || []);

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
