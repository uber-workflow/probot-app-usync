/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @typedef {{
 *   github: *,
 *   payload: import('@octokit/webhooks').WebhookPayloadIssueComment,
 * }} ProbotContextType
 */

module.exports = class ProbotCommands {
  /**
   * Convenience listeners for pull request comment commands
   * (e.g. commenting `!import`)
   *
   * @param {import('probot').Application} probotApp
   */
  constructor(probotApp) {
    this._commands = new Map();

    probotApp.on(
      ['issue_comment.created', 'issue_comment.edited'],
      this._handleWebhooks.bind(this),
    );
  }

  /**
   * @param {ProbotContextType} context
   */
  async _handleWebhooks(context) {
    const {github} = context;
    const {comment, issue, repository} = context.payload;
    const {user} = comment;

    if (issue.pull_request && issue.state === 'open' && user.type === 'User') {
      const {
        data: {permission: userPermission},
      } = await github.request(
        'GET /repos/:repoName/collaborators/:username/permission',
        {
          repoName: repository.full_name,
          username: user.login,
        },
      );

      if (userPermission === 'admin' || userPermission === 'write') {
        for (const [command, handler] of this._commands) {
          if (comment.body.replace(/\n/g, '').trim() === command) {
            return handler(context, command);
          }
        }
      }
    }
  }

  /**
   * @param {string | Array<string>} commands
   * @param {(context: ProbotContextType, command: string) => Promise<*>} handler
   * @returns {void}
   */
  on(commands, handler) {
    if (typeof commands === 'string') {
      commands = [commands];
    }

    for (const command of commands) {
      this._commands.set(command, handler);
    }
  }
};
