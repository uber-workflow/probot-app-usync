/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const get = require('just-safe-get');
const {CommitCopier, COMMIT_MESSAGE_PREFIX} = require('./CommitCopier.js');
const {
  getChild,
  getChildrenNames,
  getChildren,
  getParentName,
} = require('./relationship-utils.js');
const {sequence} = require('./utils.js');

const AUTO_SYNC_LABEL = {
  name: 'auto-sync',
  description: 'Auto-generated sync PR',
  color: '3399FF',
};

const queries = {
  getCommitStatuses: () => `query ($owner: String!, $repo: String!, $sha: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $sha) {
        ... on Commit {
          status {
            contexts {
              context
              state
            }
          }
        }
      }
    }
  }`,
  getBranchHeadSha: () => `query ($owner: String!, $repo: String!, $branchName: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $branchName) {
        target {
          oid
        }
      }
    }
  }`,
  getLabelByName: () => `query ($owner: String!, $repo: String!, $labelName: String!) {
    repository(owner: $owner, name: $repo) {
      labels(first: 1, query: $labelName) {
        nodes {
          name
        }
      }
    }
  }`,
  getPRFromBranch: ({
    includeClosed,
  }) => `query ($owner: String!, $repo: String!, $branchName: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequests(
        states: [OPEN${includeClosed ? ', CLOSED' : ''}],
        orderBy: { field: UPDATED_AT, direction: DESC },
        headRefName: $branchName,
        first: 1
      ) {
        nodes {
          author {
            login
          }
          baseRefName
          baseRefOid
          headRefOid
          number
          title
          url
        }
      }
    }
  }`,
  getPRFiles: () => `query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        files(first: 100) {
          nodes {
            path
          }
        }
      }
    }
  }`,
};

module.exports = class PRUtils {
  constructor(github) {
    this.github = github;
    this.commitCopier = new CommitCopier(github);
    // raw url request
    this.request = github.request.bind(github);
  }

  // github graphql query
  async graphql(query, props) {
    // replace `repoName` prop with `owner` and `repo` for convenience
    if (props.repoName) {
      props = {...props};
      const [owner, repo] = props.repoName.split('/');

      delete props.repoName;
      Object.assign(props, {owner, repo});
    }

    return this.github.graphql(query, props);
  }

  // props = { repoName }
  async _ensureAutoSyncLabel(props) {
    const {repoName} = props;
    const hasLabel = await this.graphql(queries.getLabelByName(), {
      ...props,
      labelName: AUTO_SYNC_LABEL.name,
    }).then(response => {
      const labelList = get(response, 'repository.labels.nodes');
      return labelList && labelList.length === 1;
    });

    if (!hasLabel) {
      await this.request('POST /repos/:repoName/labels', {
        repoName,
        data: AUTO_SYNC_LABEL,
      });
    }
  }

  // props = { repoName, sha }
  async _getCommitStatuses(props) {
    return this.graphql(queries.getCommitStatuses(), props).then(
      res => get(res, 'repository.object.status.contexts') || [],
    );
  }

  // props = { repoName, branchName }
  async _getBranchHeadSha(props) {
    return this.graphql(queries.getBranchHeadSha(), props).then(res =>
      get(res, 'repository.ref.target.oid'),
    );
  }

  // props = { repoName, branchName }
  async _getPR(props, includeClosed) {
    const PRList = await this.graphql(
      queries.getPRFromBranch({includeClosed}),
      props,
    ).then(res => get(res, 'repository.pullRequests.nodes') || []);

    if (PRList.length) {
      const PR = PRList[0];
      const [, repoShortName] = props.repoName.split('/');

      // modify data structure to match v3 api
      Object.assign(PR, {
        base: {
          ref: PR.baseRefName,
          repo: {
            name: repoShortName,
            full_name: props.repoName,
          },
          sha: PR.baseRefOid,
        },
        head: {
          ref: props.branchName,
          sha: PR.headRefOid,
        },
        html_url: PR.url,
        title: PR.title,
        user: {
          login: PR.author.login,
        },
      });

      return PR;
    }
  }

  // props = { repoName, number }
  async _getPRFiles(props) {
    return this.graphql(queries.getPRFiles(), props).then(
      res => get(res, 'repository.pullRequest.files.nodes') || [],
    );
  }

  async createParentPR(childPR) {
    const baseBranch = childPR.base.ref;
    const childRepoName = childPR.base.repo.full_name;
    const headBranch = childPR.head.ref;
    const parentRepoName = getParentName(childRepoName);
    const parentBaseSha = await this._getBranchHeadSha({
      branchName: baseBranch,
      repoName: parentRepoName,
    });

    if (parentBaseSha) {
      // intentionally not `await`ed so it happens in the background
      const autoSyncLabelExists = this._ensureAutoSyncLabel({
        repoName: parentRepoName,
      });

      return sequence([
        // create branch
        () =>
          this.request('POST /repos/:repoName/git/refs', {
            repoName: parentRepoName,
            data: {
              ref: `refs/heads/${headBranch}`,
              sha: parentBaseSha,
            },
          }),
        // copy commits
        () =>
          this.commitCopier.copyCommits({
            source: {
              afterSha: childPR.head.sha,
              beforeSha: childPR.base.sha,
              repoName: childRepoName,
            },
            target: {
              branch: headBranch,
              repoName: parentRepoName,
              sha: parentBaseSha,
              subPath: getChild(parentRepoName, childRepoName).path,
            },
          }),
        // create PR
        () =>
          Promise.all([
            this.request('POST /repos/:repoName/pulls', {
              repoName: parentRepoName,
              data: {
                title: `${childRepoName}#${childPR.number}`,
                head: headBranch,
                base: baseBranch,
                body: `This PR was generated automatically to trigger CI for ${childRepoName}#${
                  childPR.number
                }.\n\nIf any supplemental changes are needed in this repo, please make them here by pushing to the \`${headBranch}\` branch.`,
                maintainer_can_modify: true,
              },
            }),
            // have to make sure we wait for this before adding label
            autoSyncLabelExists,
          ]),
        // add auto-sync label to PR
        ([res]) =>
          this.request('POST /repos/:repoName/issues/:number/labels', {
            number: res.data.number,
            repoName: parentRepoName,
            data: {
              labels: [AUTO_SYNC_LABEL.name],
            },
          }),
      ]);
    }
  }

  async createPlaceholderStatus(PR, context) {
    await this.request('POST /repos/:repoName/statuses/:sha', {
      repoName: PR.base.repo.full_name,
      sha: PR.head.sha,
      data: {
        context,
        state: 'pending',
      },
    });
  }

  async closePR(PR) {
    await this.request('PATCH /repos/:repoName/pulls/:number', {
      number: PR.number,
      repoName: PR.base.repo.full_name,
      data: {
        state: 'closed',
      },
    });
  }

  // generates a queue key specific to the provided PR
  genQueueKey(PR, prefix) {
    const {
      number,
      base: {
        repo: {full_name: repoName},
      },
    } = PR;

    prefix = prefix ? `${prefix}-` : '';
    return prefix + `${repoName}-${number}`;
  }

  async getChildPR(parentPR, includeClosed) {
    for (const child of getChildren(parentPR.base.repo.full_name)) {
      const childPR = await this._getPR(
        {
          branchName: parentPR.head.ref,
          repoName: child.name,
        },
        includeClosed,
      );

      if (childPR) {
        return childPR;
      }
    }
  }

  async getParentPR(childPR, includeClosed) {
    return this._getPR(
      {
        branchName: childPR.head.ref,
        repoName: getParentName(childPR.base.repo.full_name),
      },
      includeClosed,
    );
  }

  async getPartnerPR(PR, includeClosed) {
    const repoName = PR.base.repo.full_name;
    const potentialRepos = []
      .concat(getParentName(repoName))
      .concat(getChildrenNames(repoName))
      .filter(Boolean);

    for (const partnerRepoName of potentialRepos) {
      const partnerPR = await this._getPR(
        {
          branchName: PR.head.ref,
          repoName: partnerRepoName,
        },
        includeClosed,
      );

      if (partnerPR) {
        return partnerPR;
      }
    }
  }

  async getPRFromPushEvent(payload) {
    return this._getPR(
      {
        branchName: payload.ref.replace(/^refs\/heads\//, ''),
        repoName: payload.repository.full_name,
      },
      false,
    );
  }

  async getPRFromChecksEvent(payload) {
    return this._getPR(
      {
        branchName: payload.check_suite.head_branch,
        repoName: payload.repository.full_name,
      },
      false,
    );
  }

  async getPRFromStatusEvent(payload) {
    for (const branch of payload.branches) {
      const PR = await this._getPR(
        {
          branchName: branch.name,
          repoName: payload.repository.full_name,
        },
        true,
      );

      if (PR) {
        return PR;
      }
    }
  }

  // mostly duplicated logic from uber-workflow/probot-app-merge-pr
  async mergePR(PR) {
    const authorLogin = PR.user.login;
    const repoName = PR.base.repo.full_name;
    const number = PR.number;
    const authorTrailerSet = await this.request(
      `GET /repos/:repoName/pulls/:number/commits`,
      {
        number,
        repoName,
      },
    ).then(res =>
      res.data.reduce((result, commit) => {
        if (commit.author.login !== authorLogin) {
          const {email, name} = commit.commit.author;
          result.add(`Co-authored-by: ${name} <${email}>`);
        }

        return result;
      }, new Set()),
    );
    let commit_message = '';

    if (authorTrailerSet.size) {
      commit_message = [...authorTrailerSet].join('\n');
    }

    await sequence([
      () =>
        this.request(`PUT /repos/:repoName/pulls/:number/merge`, {
          number,
          repoName,
          data: {
            commit_message,
            commit_title: `${PR.title} (${PR.html_url})`,
            merge_method: 'squash',
          },
        }),
      () =>
        this.request(`DELETE /repos/:repoName/git/refs/:ref`, {
          ref: `heads/${PR.head.ref}`,
          repoName,
        }),
    ]);
  }

  pushEventHasCopyableCommits(pushPayload) {
    return pushPayload.commits.some(
      commit => !commit.message.startsWith(COMMIT_MESSAGE_PREFIX),
    );
  }

  async reopenPR(PR) {
    await this.request('PATCH /repos/:repoName/pulls/:number', {
      number: PR.number,
      repoName: PR.base.repo.full_name,
      data: {
        state: 'open',
      },
    });
  }

  async syncPRStatus(fromPR, toPR, context) {
    const fromRepoName = fromPR.base.repo.full_name;
    const statuses = await this._getCommitStatuses({
      repoName: fromRepoName,
      sha: fromPR.head.sha,
    });
    const statusesSet = new Set(statuses.map(status => status.state));

    if (statusesSet.size) {
      const toRepoName = toPR.base.repo.full_name;
      let groupedStatus;

      if (statusesSet.has('ERROR')) {
        groupedStatus = 'error';
      } else if (statusesSet.has('FAILURE')) {
        groupedStatus = 'failure';
      } else if (statusesSet.has('EXPECTED') || statusesSet.has('PENDING')) {
        groupedStatus = 'pending';
      } else {
        groupedStatus = 'success';
      }

      await this.request('POST /repos/:repoName/statuses/:sha', {
        repoName: toRepoName,
        sha: toPR.head.sha,
        data: {
          context,
          state: groupedStatus,
        },
      });
    }
  }

  async syncChildRepos(parentPR) {
    const branchName = parentPR.base.ref;
    const parentRepoName = parentPR.base.repo.full_name;
    const parentPRFiles = await this._getPRFiles({
      number: parentPR.number,
      repoName: parentRepoName,
    });

    await Promise.all(
      getChildren(parentRepoName).map(async child => {
        const isIncludedInPR = parentPRFiles.some(file =>
          file.path.startsWith(`${child.path}/`),
        );
        const childSha = await this._getBranchHeadSha({
          branchName,
          repoName: child.name,
        });

        if (isIncludedInPR && childSha) {
          await this.commitCopier.copyCommits({
            source: {
              afterSha: parentPR.merge_commit_sha,
              beforeSha: parentPR.base.sha,
              repoName: parentRepoName,
              subPath: child.path,
            },
            target: {
              branch: branchName,
              genericMessage: true,
              repoName: child.name,
              sha: childSha,
            },
          });
        }
      }),
    );
  }

  async syncChildPR(pushPayload, parentPR, childPR) {
    const childRepoName = childPR.base.repo.full_name;
    const parentRepoName = parentPR.base.repo.full_name;
    const childSubpath = getChild(parentRepoName, childRepoName).path;

    if (pushPayload.forced) {
      // FIXME:
      // eslint-disable-next-line no-console
      console.warn('Forced pushes not yet supported');
    } else {
      await this.commitCopier.copyCommits({
        source: {
          afterSha: pushPayload.after,
          beforeSha: pushPayload.before,
          repoName: parentRepoName,
          subPath: childSubpath,
        },
        target: {
          branch: childPR.head.ref,
          genericMessage: true,
          repoName: childRepoName,
          sha: childPR.head.sha,
        },
      });
    }
  }

  async syncParentPR(pushPayload, childPR, parentPR) {
    const childRepoName = childPR.base.repo.full_name;
    const parentRepoName = parentPR.base.repo.full_name;
    const childSubpath = getChild(parentRepoName, childRepoName).path;

    if (pushPayload.forced) {
      // FIXME:
      // eslint-disable-next-line no-console
      console.warn('Forced pushes not yet supported');
    } else {
      await this.commitCopier.copyCommits({
        source: {
          afterSha: pushPayload.after,
          beforeSha: pushPayload.before,
          repoName: childRepoName,
        },
        target: {
          branch: parentPR.head.ref,
          repoName: parentRepoName,
          sha: parentPR.head.sha,
          subPath: childSubpath,
        },
      });
    }
  }
};
