/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const fs = require('fs');
const path = require('path');
const extend = require('just-extend');
const nock = require('nock');
const {Probot} = require('probot');
const commentCreatedFixture = require('./__fixtures__/issue_comment.created.json');
const permissionFixture = require('./__fixtures__/permission.json');
const ProbotCommands = require('./ProbotCommands.js');

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
