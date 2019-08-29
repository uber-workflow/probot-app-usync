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
   * @example
   * // your probot app
   * module.exports = app => {
   *   const commands = new ProbotCommands(app)
   *
   *   commands.on('!merge', async context => {
   *     // `context` object from probot `app.on()`
   *   })
   *
   *   // multiple commands in one listener
   *   commands.on(['!close', '!c'], async (context, command) => {
   *     // `command` is the command name that was used
   *   })
   * }
   */
  constructor(probotApp) {
    this._commands = new Map();

    probotApp.on(
      ['issue_comment.created', 'issue_comment.edited'],
      this._handleWebhooks.bind(this),
    );
  }

  _getCommentCommand(commentBody) {
    commentBody = commentBody.replace(/\r\n|\r|\n/g, '').trim();

    for (const [command] of this._commands) {
      if (commentBody === command) {
        return command;
      }
    }
  }

  /**
   * @param {ProbotContextType} context
   */
  async _handleWebhooks(context) {
    const {github} = context;
    const {comment, issue, repository} = context.payload;
    const {user} = comment;

    if (issue.pull_request && issue.state === 'open' && user.type === 'User') {
      const command = this._getCommentCommand(comment.body);

      if (command) {
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
          const handler = this._commands.get(command);
          return handler(context, command);
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
