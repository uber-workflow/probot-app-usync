/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const path = require('path');
const fse = require('fs-extra');
const execa = require('execa');
const get = require('just-safe-get');
const {sequence} = require('./utils.js');

const npmBinPath = execa.shellSync('npm bin').stdout;
const NOT_SUBTREE_PATH = path.resolve(npmBinPath, 'not-subtree');
const TEMP_DIR = '.tmp';
const AUTO_SYNC_LABEL = {
  name: 'auto-sync',
  description: 'Auto-generated sync PR',
  color: '3399FF',
};

const queries = {
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
          baseRefName
          headRefOid
          number
          state
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
  getRepoRef: () => `query ($owner: String!, $repo: String!, $ref: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $ref) {
        name
      }
    }
  }`,
};

function repoProps(repoFullName, props = {}) {
  const [owner, repo] = repoFullName.split('/');
  return {...props, owner, repo};
}

module.exports = class PRUtils {
  constructor(github, relationshipMap) {
    this.github = github;
    this.relationshipMap = relationshipMap;
  }

  // props = { owner, repo }
  async _ensureAutoSyncLabel(props) {
    const hasLabel = await this.github
      .query(queries.getLabelByName(), {
        ...props,
        labelName: AUTO_SYNC_LABEL.name,
      })
      .then(response => {
        const labelList = get(response, 'repository.labels.nodes');
        return labelList && labelList.length === 1;
      });

    if (!hasLabel) {
      await this.github.issues.createLabel({
        ...props,
        ...AUTO_SYNC_LABEL,
      });
    }
  }

  // props = { owner, repo, branchName }
  async _getPR(props, includeClosed) {
    const response = await this.github.query(
      queries.getPRFromBranch({includeClosed}),
      props,
    );
    const PRList = get(response, 'repository.pullRequests.nodes');

    if (PRList && PRList.length) {
      const PR = PRList[0];
      const repoName = `${props.owner}/${props.repo}`;

      // modify data structure to match v3 api
      Object.assign(PR, {
        base: {
          ref: PR.baseRefName,
          repo: {
            name: props.repo,
            full_name: repoName,
            ssh_url: `git@github.com:${repoName}.git`,
          },
        },
        head: {
          ref: props.branchName,
          sha: PR.headRefOid,
        },
      });

      return PR;
    }
  }

  // props = { owner, repo, number }
  async _getPRFiles(props) {
    return this.github
      .query(queries.getPRFiles(), props)
      .then(res => get(res, 'repository.pullRequest.files.nodes') || []);
  }

  async _repoHasBranch(repoName, branchName) {
    return this.github
      .query(
        queries.getRepoRef(),
        repoProps(repoName, {ref: `refs/heads/${branchName}`}),
      )
      .then(res => get(res, 'repository.ref.name') === branchName);
  }

  async createParentPR(childPR) {
    const {
      number,
      head: {ref: sourceBranch},
      base: {
        ref: targetBranch,
        repo: {full_name: childRepo, ssh_url: childRemote},
      },
    } = childPR;
    const parentRepo = this.relationshipMap.get(childRepo).parent;
    const [, parentRepoName] = parentRepo.split('/');
    const parentRemote = `git@github.com:${parentRepo}.git`;
    const autoSyncLabelExists = this._ensureAutoSyncLabel(
      repoProps(parentRepo),
    );
    const childSubpath = this.relationshipMap
      .get(parentRepo)
      .children.find(child => child.name === childRepo).path;

    await sequence([
      () => fse.remove(TEMP_DIR),
      () => fse.ensureDir(TEMP_DIR),
      () =>
        execa.shell(
          [
            `git clone ${parentRemote} --branch=${targetBranch}`,
            `cd ${parentRepoName}`,
            `git checkout -b ${sourceBranch}`,
            `${NOT_SUBTREE_PATH} pull --path=${childSubpath} --remote=${childRemote} --base-branch=${targetBranch} --head-branch=${sourceBranch} --message='Pull subtree from ${childRepo}'`,
            `git push origin ${sourceBranch}`,
          ].join(' && '),
          {cwd: TEMP_DIR},
        ),
      () =>
        Promise.all([
          this.github.pullRequests.create(
            repoProps(parentRepo, {
              title: `${childRepo}#${number}`,
              head: sourceBranch,
              base: targetBranch,
              body: `This PR was generated automatically to trigger CI for ${childRepo}#${number}.\n\nIf any supplemental changes are needed in this repo, please make them here by pushing to the \`${sourceBranch}\` branch.`,
              maintainer_can_modify: true,
            }),
          ),
          autoSyncLabelExists,
        ]),
      ([parentPR]) =>
        this.github.issues.addLabels(
          repoProps(parentRepo, {
            number: parentPR.data.number,
            labels: [AUTO_SYNC_LABEL.name],
          }),
        ),
    ]);
  }

  async closePR(PR) {
    const {
      number,
      base: {
        repo: {full_name: repoName},
      },
    } = PR;

    await this.github.pullRequests.update(
      repoProps(repoName, {
        number,
        state: 'closed',
      }),
    );
  }

  async getChildPR(parentPR, includeClosed) {
    const {
      head: {ref: branchName},
      base: {
        repo: {full_name: parentRepo},
      },
    } = parentPR;
    const {children} = this.relationshipMap.get(parentRepo);

    for (const child of children) {
      const childPR = await this._getPR(
        repoProps(child.name, {branchName}),
        includeClosed,
      );

      if (childPR) {
        return childPR;
      }
    }
  }

  async getParentPR(childPR, includeClosed) {
    const {
      head: {ref: branchName},
      base: {
        repo: {full_name: childRepo},
      },
    } = childPR;
    const parentRepo = this.relationshipMap.get(childRepo).parent;

    return this._getPR(repoProps(parentRepo, {branchName}), includeClosed);
  }

  async getChildPRFromStatusEvent(payload) {
    const {
      branches,
      repository: {full_name: parentRepo},
    } = payload;
    const branchNames = branches.map(branch => branch.name);
    const childRepos = this.relationshipMap.get(parentRepo).children;

    for (const child of childRepos) {
      for (const branchName of branchNames) {
        const PR = await this._getPR(repoProps(child.name, {branchName}), true);

        if (PR) {
          return PR;
        }
      }
    }
  }

  isAutoSyncPR(PR) {
    return PR.labels.some(label => label.name === AUTO_SYNC_LABEL.name);
  }

  async reopenPR(PR) {
    const {
      number,
      base: {
        repo: {full_name: repoName},
      },
    } = PR;

    await this.github.pullRequests.update(
      repoProps(repoName, {
        number,
        state: 'open',
      }),
    );
  }

  async syncChildPRStatus(status, childPR) {
    const {context, description, state, target_url} = status;
    const {
      head: {sha},
      base: {
        repo: {full_name: childRepo},
      },
    } = childPR;

    await this.github.repos.createStatus(
      repoProps(childRepo, {
        context,
        description,
        sha,
        state,
        target_url,
      }),
    );
  }

  // TODO: only do if child repo has the branch
  async syncChildRepos(parentPR) {
    const {
      number: PRNumber,
      base: {
        ref: branchName,
        sha: baseSha,
        repo: {
          full_name: parentRepo,
          name: parentRepoName,
          ssh_url: parentRemote,
        },
      },
    } = parentPR;
    const {children} = this.relationshipMap.get(parentRepo);
    const parentPRFiles = await this._getPRFiles(
      repoProps(parentRepo, {
        number: PRNumber,
      }),
    );

    await Promise.all(
      children.map(async child => {
        const childIsIncludedInPR = parentPRFiles.some(file =>
          file.path.startsWith(`${child.path}/`),
        );

        if (childIsIncludedInPR) {
          const childRemote = `git@github.com:${child.name}.git`;

          if (await this._repoHasBranch(child.name, branchName)) {
            await sequence([
              () => fse.remove(path.join(TEMP_DIR, parentRepoName)),
              () => fse.ensureDir(TEMP_DIR),
              () =>
                execa.shell(
                  [
                    `git clone ${parentRemote} --branch=${branchName}`,
                    `cd ${parentRepoName}`,
                    `${NOT_SUBTREE_PATH} push --path=${
                      child.path
                    } --remote=${childRemote} --base-branch=${baseSha}`,
                  ].join(' && '),
                  {cwd: TEMP_DIR},
                ),
            ]);
          }
        }
      }),
    );
  }

  async syncChildPR(parentPR, childPR) {
    const {
      head: {ref: sourceBranch},
      base: {
        ref: targetBranch,
        repo: {
          full_name: parentRepo,
          name: parentRepoName,
          ssh_url: parentRemote,
        },
      },
    } = parentPR;
    const {
      base: {
        repo: {full_name: childRepo, ssh_url: childRemote},
      },
    } = childPR;
    const childSubpath = this.relationshipMap
      .get(parentRepo)
      .children.find(child => child.name === childRepo).path;

    await sequence([
      () => fse.remove(TEMP_DIR),
      () => fse.ensureDir(TEMP_DIR),
      () =>
        execa.shell(
          [
            `git clone ${parentRemote} --branch=${sourceBranch}`,
            `cd ${parentRepoName}`,
            `${NOT_SUBTREE_PATH} push --path=${childSubpath} --remote=${childRemote} --base-branch=${targetBranch} --remote-branch=${sourceBranch} --message='Push tree update from parent repo'`,
          ].join(' && '),
          {cwd: TEMP_DIR},
        ),
    ]);
  }

  async syncParentPR(childPR, parentPR) {
    const {
      head: {ref: sourceBranch},
      base: {
        ref: targetBranch,
        repo: {full_name: childRepo, ssh_url: childRemote},
      },
    } = childPR;
    const {
      base: {
        repo: {
          full_name: parentRepo,
          name: parentRepoName,
          ssh_url: parentRemote,
        },
      },
    } = parentPR;
    const childSubpath = this.relationshipMap
      .get(parentRepo)
      .children.find(child => child.name === childRepo).path;

    await sequence([
      () => fse.remove(TEMP_DIR),
      () => fse.ensureDir(TEMP_DIR),
      () =>
        execa.shell(
          [
            `git clone ${parentRemote} --branch=${sourceBranch}`,
            `cd ${parentRepoName}`,
            `${NOT_SUBTREE_PATH} pull --path=${childSubpath} --remote=${childRemote} --base-branch=${targetBranch} --head-branch=${sourceBranch} --message='Pull subtree from ${childRepo}'`,
            `git push origin ${sourceBranch}`,
          ].join(' && '),
          {cwd: TEMP_DIR},
        ),
    ]);
  }
};
