/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {USyncError} = require('usyncit');

function quoteLines(input) {
  return input
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

function codeBlock(content, language) {
  return '```' + (language || '') + '\n' + content + '\n```';
}

// error_noImportFromParent
// error_mustLandFromParent
module.exports = {
  notify_importedFromChild: url =>
    `This pull request has been imported. If you have access to the parent repo, you can view the imported change [here](${url}).`,

  /**
   * @param {{
   *   importedPR: {
   *     number: number,
   *     repoName: string,
   *   },
   *   importer: string,
   * }} props
   */
  notify_importedToParent: ({importedPR, importer}) =>
    `This pull request was imported from ${importedPR.repoName}#${importedPR.number} by @${importer}. Comment \`!land\` when the change is ready to be landed.`,
  notify_issueClosed: prNumber => `This issue was closed via #${prNumber}.`,
  notify_landed: sha => `This pull request was landed via ${sha}.`,
  error_approval: command =>
    `Unable to ${command}. At least one approved review is required.`,
  error_branchNotMergeable: command =>
    `Unable to ${command}. This branch isn't mergeable.`,
  error_mustLandFromParent: () =>
    'Unable to land. Can only land from the parent repo.',
  error_noImportFromParent: () =>
    `Unable to import. Cannot import from the parent repo.`,
  error_noLandDuringRelease: url =>
    `Landing is restricted while a [release pull request](${url}) is open. Retry once the release has landed.`,
  error_noPRTemplate: command =>
    `Unable to ${command}. \`.github/pull_request_template.md\` not found in parent repo.`,
  error_PRNotOpen: command =>
    `Unable to ${command}. This pull request isn't open.`,
  error_targetNotMaster: () =>
    '`!import` and `!land` are only required for pull requests targeting the `master` branch.',
  error_SyncError: (command, error) => {
    error =
      error instanceof USyncError ? error.message : 'Internal Server Error';

    return `:boom: **Error when attempting to ${command}:**\n\n${quoteLines(
      error,
    )}`;
  },

  /**
   * @param {{
   *   importedPR: {
   *     body: string,
   *     repoName: string,
   *     title: string,
   *   },
   *   template: string,
   * }} props
   */
  PRBody_imported: ({importedPR, template}) =>
    template
      .replace(/\r\n|\r|\n/g, '\n')
      .split('\n')
      .map(line => {
        if (
          line === '*No summary provided*' &&
          importedPR.body.replace(/\n/g, '').trim()
        ) {
          line = importedPR.body;
        } else if (line === `**${importedPR.repoName}**`) {
          let override = importedPR.title;

          if (importedPR.body) {
            override += `\n\n${importedPR.body}`;
          }

          line += `\n${codeBlock(override)}`;
        }

        return line;
      })
      .join('\n'),
};
