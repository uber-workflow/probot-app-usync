/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {request} from './github';

/**
 * @typedef {import('@octokit/webhooks').WebhookPayloadIssueComment} WebhookPayloadIssueComment
 *
 * @typedef {{
 *   github: *,
 *   payload: WebhookPayloadIssueComment,
 * }} ProbotContextType
 */

export default class ProbotCommands {
  constructor(probotApp) {
    this._commands = new Map();

    probotApp.on(
      ['issue_comment.created', 'issue_comment.edited'],
      this._handleWebhooks.bind(this),
    );
  }

  async _handleWebhooks(context) {
    const {comment, issue, repository} = context.payload;
    const {user} = comment;

    if (issue.pull_request && issue.state === 'open' && user.type === 'User') {
      const {permission: userPermission} = await request(
        'GET /repos/:repoName/collaborators/:username/permission',
        {
          repoName: repository.full_name,
          username: user.login,
        },
      );

      if (userPermission === 'admin' || userPermission === 'write') {
        for (const [command, handler] of this._commands) {
          if (comment.body.replace(/\n/g, '').trim() === command) {
            return handler(context);
          }
        }
      }
    }
  }

  /**
   * @param {string} command
   * @param {(context: ProbotContextType) => Promise<*>} handler
   */
  on(command, handler) {
    this._commands.set(command, handler);
  }
}
