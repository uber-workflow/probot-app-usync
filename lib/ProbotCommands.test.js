/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import extend from 'just-extend';
import nock from 'nock';
import {Probot} from 'probot';
import commentCreatedFixture from './__fixtures__/issue_comment.created.json';
import permissionFixture from './__fixtures__/permission.json';
import ProbotCommands from './ProbotCommands.js';

jest.mock('./github/utils.js');
nock.disableNetConnect();

const fixtures = {
  comment: extend(true, {}, commentCreatedFixture, {
    comment: {
      body: '!foo',
      user: {
        login: 'test-user',
      },
    },
    repository: {
      full_name: 'org/test-repo',
    },
  }),
  permission: {
    admin: extend({}, permissionFixture, {
      permission: 'admin',
    }),
    read: extend({}, permissionFixture, {
      permission: 'read',
    }),
  },
};

function createProbot(entry) {
  // ref: https://github.com/probot/create-probot-app/blob/de9078d/templates/basic-js/test/fixtures/mock-cert.pem
  const cert = fs.readFileSync(
    path.resolve(__dirname, '__fixtures__/mock-cert.pem'),
    'utf-8',
  );
  const probot = new Probot({
    cert,
    id: 123,
  });

  probot.load(entry);
  return probot;
}

test('ProbotCommands', async () => {
  let triggerCount = 0;
  const probot = createProbot(app => {
    const commands = new ProbotCommands(app);
    commands.on('!foo', async () => triggerCount++);
  });

  async function runCommandTest(permissionFixture, commentFixture) {
    nock('https://api.github.com')
      .get('/repos/org/test-repo/collaborators/test-user/permission')
      .reply(200, permissionFixture);
    await probot.receive({
      name: 'issue_comment',
      payload: commentFixture,
    });
  }

  // SHOULD NOT trigger
  await runCommandTest(fixtures.permission.read, fixtures.comment);

  // SHOULD NOT trigger
  await runCommandTest(
    fixtures.permission.admin,
    extend(true, {}, fixtures.comment, {
      comment: {body: 'bar'},
    }),
  );

  // SHOULD NOT trigger
  await runCommandTest(
    fixtures.permission.admin,
    extend(true, {}, fixtures.comment, {
      issue: {state: 'closed'},
    }),
  );

  // SHOULD trigger
  await runCommandTest(fixtures.permission.admin, fixtures.comment);

  // SHOULD trigger
  await runCommandTest(
    fixtures.permission.admin,
    extend({}, fixtures.comment, {
      action: 'edited',
    }),
  );

  expect(triggerCount).toBe(2);
});
