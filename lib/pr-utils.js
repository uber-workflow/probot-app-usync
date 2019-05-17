/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import get from 'just-safe-get';
import github from './github.js';
import {COMMIT_MESSAGE_PREFIX, copyCommits} from './commit-utils.js';
import {
  getChild,
  getChildrenNames,
  getChildren,
  getParentName,
  hasChildren,
  hasParent,
} from './relationship-utils.js';
import {sequence} from './utils.js';

const request = github.request;

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
          baseRepository {
            name
            nameWithOwner
          }
          headRefName
          headRefOid
          headRepository {
            name
            nameWithOwner
          }
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

// github graphql query
async function graphql(query, props) {
  // replace `repoName` prop with `owner` and `repo` for convenience
  if (props.repoName) {
    props = {...props};
    const [owner, repo] = props.repoName.split('/');

    delete props.repoName;
    Object.assign(props, {owner, repo});
  }

  return github.graphql(query, props);
}

/**
 * @param {{
 *   repoName: string,
 *   sha: string,
 * }} props
 * @returns {Promise<string[]>}
 */
async function getCommitStatuses(props) {
  return graphql(queries.getCommitStatuses(), props).then(
    res => get(res, 'repository.object.status.contexts') || [],
  );
}

/**
 * @param {{
 *   branchName: string,
 *   repoName: string,
 * }} props
 * @returns {Promise<string>}
 */
async function getBranchHeadSha(props) {
  return graphql(queries.getBranchHeadSha(), props).then(res =>
    get(res, 'repository.ref.target.oid'),
  );
}

/**
 * @param {{
 *   branchName: string,
 *   repoName: string,
 * }} props
 * @returns {Promise<PullRequestType|void>}
 */
async function getPR(props, includeClosed) {
  const PRList = await graphql(
    queries.getPRFromBranch({includeClosed}),
    props,
  ).then(res => get(res, 'repository.pullRequests.nodes') || []);

  if (PRList.length) {
    const PR = PRList[0];

    // modify data structure to match v3 api
    Object.assign(PR, {
      base: {
        ref: PR.baseRefName,
        repo: {
          full_name: PR.baseRepository.nameWithOwner,
          name: PR.baseRepository.name,
        },
        sha: PR.baseRefOid,
      },
      head: {
        ref: PR.headRefName,
        repo: {
          full_name: PR.headRepository.nameWithOwner,
          name: PR.headRepository.name,
        },
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

/**
 * @param {{
 *   number: string,
 *   repoName: string,
 * }} props
 * @returns {Promise<any[]>}
 */
async function getPRFiles(props) {
  return graphql(queries.getPRFiles(), props).then(
    res => get(res, 'repository.pullRequest.files.nodes') || [],
  );
}

export async function createParentPR(childPR) {
  const baseBranch = childPR.base.ref;
  const childRepoName = childPR.base.repo.full_name;
  const headBranch = `${childRepoName}/${childPR.head.ref}`;
  const parentRepoName = getParentName(childRepoName);
  const parentBaseSha = await getBranchHeadSha({
    branchName: baseBranch,
    repoName: parentRepoName,
  });

  if (parentBaseSha) {
    return sequence([
      // create branch
      () =>
        request('POST /repos/:repoName/git/refs', {
          repoName: parentRepoName,
          data: {
            ref: `refs/heads/${headBranch}`,
            sha: parentBaseSha,
          },
        }),
      // copy commits
      () =>
        copyCommits({
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
        request('POST /repos/:repoName/pulls', {
          repoName: parentRepoName,
          data: {
            title: `Sync ${childRepoName}#${childPR.number}`,
            head: headBranch,
            base: baseBranch,
            body: `This PR was generated automatically to trigger CI for ${childRepoName}#${
              childPR.number
            }.\n\nIf any supplemental changes are needed in this repo, please make them here by pushing to the \`${headBranch}\` branch.`,
            maintainer_can_modify: true,
          },
        }),
    ]);
  }
}

export async function createPlaceholderStatus(PR, context) {
  await request('POST /repos/:repoName/statuses/:sha', {
    repoName: PR.base.repo.full_name,
    sha: PR.head.sha,
    data: {
      context,
      state: 'pending',
    },
  });
}

export async function closePR(PR) {
  await request('PATCH /repos/:repoName/pulls/:number', {
    number: PR.number,
    repoName: PR.base.repo.full_name,
    data: {
      state: 'closed',
    },
  });
}

// generates a queue key specific to the provided PR
export function genQueueKey(PR, prefix) {
  const {
    number,
    base: {
      repo: {full_name: repoName},
    },
  } = PR;

  prefix = prefix ? `${prefix}-` : '';
  return prefix + `${repoName}-${number}`;
}

export async function getPartnerPR_old(PR, includeClosed) {
  const repoName = PR.base.repo.full_name;
  const potentialRepos = []
    .concat(getParentName(repoName))
    .concat(getChildrenNames(repoName))
    .filter(Boolean);

  for (const partnerRepoName of potentialRepos) {
    const partnerPR = await getPR(
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

export async function getPartnerPR(PR, includeClosed) {
  // FIXME: remove this once all existing PRs are merged that use old naming convention
  const partnerPR = await getPartnerPR_old(PR, includeClosed);

  if (partnerPR) {
    return partnerPR;
  } else {
    const branchName = PR.head.ref;
    const repoName = PR.base.repo.full_name;

    if (hasChildren(repoName)) {
      const [childOrg, childRepo, ...branchParts] = branchName.split('/');
      const partnerPR = await getPR(
        {
          branchName: branchParts.join('/'),
          repoName: `${childOrg}/${childRepo}`,
        },
        includeClosed,
      );

      if (partnerPR) {
        return partnerPR;
      }
    } else if (hasParent(repoName)) {
      const parentName = getParentName(repoName);
      const partnerPR = await getPR(
        {
          branchName: `${repoName}/${branchName}`,
          repoName: parentName,
        },
        includeClosed,
      );

      if (partnerPR) {
        return partnerPR;
      }
    }
  }
}

export async function getPRFromPushPayload(payload) {
  return getPR(
    {
      branchName: payload.ref.replace(/^refs\/heads\//, ''),
      repoName: payload.repository.full_name,
    },
    false,
  );
}

export async function getPRFromChecksPayload(payload) {
  return getPR(
    {
      branchName: payload.check_suite.head_branch,
      repoName: payload.repository.full_name,
    },
    false,
  );
}

export async function getPRFromStatusPayload(payload) {
  for (const branch of payload.branches) {
    const PR = await getPR(
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
export async function mergePR(PR) {
  const authorLogin = PR.user.login;
  const repoName = PR.base.repo.full_name;
  const number = PR.number;
  const authorTrailerSet = await request(
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

  await request(`PUT /repos/:repoName/pulls/:number/merge`, {
    number,
    repoName,
    data: {
      commit_message,
      commit_title: `${PR.title} (${PR.html_url})`,
      merge_method: 'squash',
    },
  });
}

export function pushPayloadHasCopyableCommits(pushPayload) {
  return pushPayload.commits.some(
    commit => !commit.message.startsWith(COMMIT_MESSAGE_PREFIX),
  );
}

export async function reopenPR(PR) {
  await request('PATCH /repos/:repoName/pulls/:number', {
    number: PR.number,
    repoName: PR.base.repo.full_name,
    data: {
      state: 'open',
    },
  });
}

export async function syncPRStatus(fromPR, toPR, context) {
  const fromRepoName = fromPR.base.repo.full_name;
  const toRepoName = toPR.base.repo.full_name;
  const [statesSet, previousState] = await Promise.all([
    getCommitStatuses({
      repoName: fromRepoName,
      sha: fromPR.head.sha,
    }).then(
      statuses =>
        new Set(
          statuses
            .filter(status => !/-monorepo\/ci$/.test(status.context))
            .map(status => status.state),
        ),
    ),
    getCommitStatuses({
      repoName: toRepoName,
      sha: toPR.head.sha,
    }).then(statuses => {
      const groupedStatus = statuses.find(status =>
        /-monorepo\/ci$/.test(status.context),
      );
      return groupedStatus && groupedStatus.state;
    }),
  ]);
  let groupedState;

  if (statesSet.has('ERROR')) {
    groupedState = 'error';
  } else if (statesSet.has('FAILURE')) {
    groupedState = 'failure';
  } else if (statesSet.has('EXPECTED') || statesSet.has('PENDING')) {
    groupedState = 'pending';
  } else {
    groupedState = 'success';
  }

  if (!previousState || groupedState !== previousState.toLowerCase()) {
    await request('POST /repos/:repoName/statuses/:sha', {
      repoName: toRepoName,
      sha: toPR.head.sha,
      data: {
        context,
        state: groupedState,
      },
    });
  }
}

export async function syncChildRepos(parentPR) {
  const branchName = parentPR.base.ref;
  const parentRepoName = parentPR.base.repo.full_name;
  const parentPRFiles = await getPRFiles({
    number: parentPR.number,
    repoName: parentRepoName,
  });

  await Promise.all(
    getChildren(parentRepoName).map(async child => {
      const isIncludedInPR = parentPRFiles.some(file =>
        file.path.startsWith(`${child.path}/`),
      );
      const childSha = await getBranchHeadSha({
        branchName,
        repoName: child.name,
      });

      if (isIncludedInPR && childSha) {
        await copyCommits({
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

export async function syncChildPR(pushPayload, parentPR, childPR) {
  const childBaseRepoName = childPR.base.repo.full_name;
  const childHeadRepoName = childPR.head.repo.full_name;
  const parentRepoName = parentPR.base.repo.full_name;
  const childSubpath = getChild(parentRepoName, childBaseRepoName).path;

  if (pushPayload.forced) {
    // FIXME:
    // eslint-disable-next-line no-console
    console.warn('Forced pushes not yet supported');
  } else {
    await copyCommits({
      source: {
        afterSha: pushPayload.after,
        beforeSha: pushPayload.before,
        repoName: parentRepoName,
        subPath: childSubpath,
      },
      target: {
        branch: childPR.head.ref,
        genericMessage: true,
        repoName: childHeadRepoName,
        sha: childPR.head.sha,
      },
    });
  }
}

export async function syncParentPR(pushPayload, childPR, parentPR) {
  const childRepoName = childPR.base.repo.full_name;
  const parentRepoName = parentPR.base.repo.full_name;
  const childSubpath = getChild(parentRepoName, childRepoName).path;

  if (pushPayload.forced) {
    // FIXME:
    // eslint-disable-next-line no-console
    console.warn('Forced pushes not yet supported');
  } else {
    await copyCommits({
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
