/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const get = require('just-safe-get');
const pick = require('just-pick');
const {GitHubAPI, ProbotOctokit} = require('probot/lib/github');
const OctokitAuthPlugin = require('./OctokitAuthPlugin.js');

// same as probot's `context.github` instance, but specially
// authorized via the custom plugin
const github = new GitHubAPI({
  Octokit: ProbotOctokit.plugin([OctokitAuthPlugin]),
});

/**
 * @typedef {import('@octokit/rest').PullsCreateResponse} PullsCreateResponse
 *
 * @typedef {{
 *   github: *,
 *   payload: import('@octokit/webhooks').WebhookPayloadIssueComment,
 * }} ProbotContextType
 *
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PullRequestOpt
 */

/**
 * @param {ProbotContextType} context
 * @returns {Promise<PullRequestOpt & {
 *   author: {
 *     login: string,
 *   },
 *   baseRefName: string,
 *   body: string,
 *   headRefName: string,
 *   headRepository: {
 *     nameWithOwner: string,
 *   },
 *   mergeable: 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN',
 *   mergeStateStatus: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE',
 *   reviews: {
 *     nodes: {
 *       state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING',
 *     }[],
 *   },
 *   state: 'CLOSED' | 'MERGED' | 'OPEN',
 *   title: string,
 *   url: string,
 * }>}
 */
async function getPullRequestInfo({payload}) {
  return github
    .graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            author {
              login
            }
            baseRefName
            body
            headRefName
            headRepository {
              nameWithOwner
            }
            mergeable
            mergeStateStatus
            number
            reviews(first: 10, states: [APPROVED]) {
              nodes {
                state
              }
            }
            state
            title
            url
          }
        }
      }`,
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        number: payload.issue.number,
        headers: {
          // https://developer.github.com/v4/previews/#mergeinfopreview---more-detailed-information-about-a-pull-requests-merge-state
          accept: 'application/vnd.github.merge-info-preview+json',
        },
      },
    )
    .then(async res => {
      const result = {
        ...get(res, 'repository.pullRequest'),
        repoName: payload.repository.full_name,
      };

      // graphql api returns `null` for repos the app isn't installed on,
      // but REST doesn't. supplement the data via REST in this case
      if (!result.headRepository) {
        const nameWithOwner = await github
          .request('GET /repos/:repoName/pulls/:number', {
            repoName: payload.repository.full_name,
            number: payload.issue.number,
          })
          .then(res => get(res, 'data.head.repo.full_name'));

        result.headRepository = {nameWithOwner};
      }

      return result;
    });
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} body
 * @returns {Promise<*>}
 */
async function addComment(pullRequest, body) {
  return github.request('POST /repos/:repoName/issues/:number/comments', {
    ...pick(pullRequest, ['repoName', 'number']),
    data: {body},
  });
}

/**
 * @param {PullRequestOpt} issue
 * @param {string} label
 * @returns {Promise<*>}
 */
async function addLabel(issue, label) {
  const {repoName} = issue;
  const repoHasLabel = await github
    .request('GET /repos/:repoName/labels', {repoName})
    .then(({data: labels}) =>
      labels.find(repoLabel => repoLabel.name === label),
    );

  if (!repoHasLabel) {
    await github.request('POST /repos/:repoName/labels', {
      repoName,
      data: {
        color: 'ededed',
        name: label,
      },
    });
  }

  return github.request('POST /repos/:repoName/issues/:number/labels', {
    ...pick(issue, ['repoName', 'number']),
    data: {
      labels: [label],
    },
  });
}

/**
 * @param {PullRequestOpt} issue
 * @returns {Promise<*>}
 */
async function closeIssue(issue) {
  return github.request('PATCH /repos/:repoName/pulls/:number', {
    ...pick(issue, ['repoName', 'number']),
    data: {
      state: 'closed',
    },
  });
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} branchName
 * @returns {Promise<*>}
 */
async function deleteBranch(pullRequest, branchName) {
  return github.request('DELETE /repos/:repoName/git/refs/heads/:branchName', {
    repoName: pullRequest.repoName,
    branchName,
  });
}

/**
 * @param {{
 *   data: {
 *     base: string,
 *     head: string,
 *     title: string,
 *     body: string,
 *     draft?: boolean,
 *     maintainer_can_modify?: boolean,
 *   },
 *   repoName: string,
 * }} opts
 * @returns {Promise<PullsCreateResponse>}
 */
async function createPullRequest(opts) {
  return github
    .request('POST /repos/:repoName/pulls', opts)
    .then(res => res.data);
}

/**
 * @param {ProbotContextType} context
 * @returns {(PullRequestOpt & {
 *   title: string,
 *   url: string,
 * }) | void}
 */
async function findOpenReleasePR({payload}) {
  return github
    .graphql(
      `query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: 100, states: [OPEN]) {
            nodes {
              number
              title
              url
            }
          }
        }
      }`,
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
      },
    )
    .then(res => {
      const releasePR = (get(res, 'repository.pullRequests.nodes') || []).find(
        pullRequest => pullRequest.title.startsWith('Release '),
      );

      if (releasePR) {
        return {
          ...releasePR,
          repoName: payload.repository.full_name,
        };
      }
    });
}

/**
 * @param {string} repoName
 * @param {string} filepath
 * @returns {string} raw text content
 */
async function getFileContent(repoName, filepath) {
  const content = await github
    .request('GET /repos/:repoName/contents/:filepath', {
      repoName,
      filepath,
    })
    .then(res => get(res, 'data.content'));

  return content && Buffer.from(content, 'base64').toString('utf-8');
}

/**
 * @param {string} body
 * @returns {{
 *   overrides: Object<string, string>,
 *   summary: string,
 * }}
 */
function parsePRBody(body) {
  return (
    body
      .replace(/\r\n|\r|\n/g, '\n')
      // strip html comments
      .replace(/<!--[\s\S]*?(?:-->)/g, '')
      .split(/^(?=## .+)/m)
      .reduce((result, section) => {
        const content = section
          .replace(/^## ?.+\n/, '')
          .replace(/^\n+|\n+$/g, '');

        if (section.startsWith('## Summary')) {
          result.summary = content.replace('*No summary provided*', '').trim();
        } else if (section.startsWith('## Commit message overrides')) {
          result.overrides = content
            .split(/^(?=\*\*[^*]+\*\*\n`{3,})/m)
            .reduce((overrides, section) => {
              section = section.replace(/^\n+|\n+$/g, '');
              const isValid = /^\*\*[^*]+\*\*.*\n`{3,}.*\n[\s\S]+\n`{3,}$/.test(
                section,
              );

              if (isValid) {
                const lines = section.split('\n');
                const repoName = lines[0].trim().replace(/^\*\*|\*\*$/g, '');
                const message = lines.slice(2, -1).join('\n');

                if (repoName && message) {
                  overrides[repoName] = message;
                }
              }

              return overrides;
            }, {});
        }

        return result;
      }, {})
  );
}

/**
 * @param {PullRequestOpt} pullRequest
 * @param {string} label
 * @returns {Promise<Boolean>}
 */
async function prHasLabel(pullRequest, label) {
  const {number, repoName} = pullRequest;
  const [owner, repo] = repoName.split('/');

  return github
    .graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            labels(first: 20) {
              nodes { name }
            }
          }
        }
      }`,
      {owner, repo, number},
    )
    .then(res =>
      (get(res, 'repository.pullRequest.labels.nodes') || [])
        .map(prLabel => prLabel.name)
        .includes(label),
    );
}

/**
 * @param {PullRequestOpt & {
 *   title: string,
 * }} pullRequest
 * @returns {Promise<void>}
 */
async function mergeReleasePR(pullRequest) {
  const {number, repoName, title, url} = pullRequest;
  return github.request('PUT /repos/:repoName/pulls/:number/merge', {
    number,
    repoName,
    data: {
      commit_title: `${title} (#${number})`,
      commit_message: url,
      merge_method: 'squash',
    },
  });
}

module.exports = {
  addComment,
  addLabel,
  closeIssue,
  createPullRequest,
  deleteBranch,
  findOpenReleasePR,
  getFileContent,
  getPullRequestInfo,
  mergeReleasePR,
  parsePRBody,
  prHasLabel,
};
