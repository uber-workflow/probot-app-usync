/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const {generateCommitMessages} = require('./index.js');

test('generateCommitMessages', () => {
  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body: '## Summary\n\nParent PR summary',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title\n\nParent PR summary',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10\n\nParent PR summary',
  });

  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body: '## Summary\n\n',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10',
  });

  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body:
        '## Summary\n\n<!-- Replace this with your own summary -->\n*No summary provided*\n\n',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10',
  });

  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body:
        '## Summary\n\nParent PR summary\n\n## Commit message overrides\n\n**foo/child**\n```\nSome custom child title\n\ncustom child summary\n```',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title\n\nParent PR summary',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10\n\nParent PR summary',
    'foo/child': 'Some custom child title\n\ncustom child summary',
  });

  expect(
    generateCommitMessages(
      {
        repoName: 'foo/parent',
        number: 10,
        body:
          '## Summary\n\nParent PR summary\n\n## Commit message overrides\n\n<!--\nHTML comment\n-->\n\n**foo/child**\n```\nSome custom child title\n\ncustom child summary\n```',
        title: 'Parent PR title',
      },
      {
        repoName: 'foo/child',
        number: 20,
      },
    ),
  ).toEqual({
    generic: 'Parent PR title\n\nParent PR summary',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10\n\nParent PR summary',
    'foo/child':
      'Some custom child title (#20)\nhttps://github.com/foo/child/pull/20\n\ncustom child summary',
  });

  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body:
        '## Summary\n\nParent PR summary\n\n## Commit message overrides\n\n**foo/child**\n````\nSome custom child title\n\ncustom child summary with a code block\n\n```\nconsole.log("hi")\n```\n````',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title\n\nParent PR summary',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10\n\nParent PR summary',
    'foo/child':
      'Some custom child title\n\ncustom child summary with a code block\n\n```\nconsole.log("hi")\n```',
  });

  expect(
    generateCommitMessages({
      repoName: 'foo/parent',
      number: 10,
      body:
        '## Summary\n\nParent PR summary\n\n## Commit message overrides\n\n**foo/child**\n```\nChild PR title\n\n**some-bolded-thing**\nblahblah\n```',
      title: 'Parent PR title',
    }),
  ).toEqual({
    generic: 'Parent PR title\n\nParent PR summary',
    'foo/parent':
      'Parent PR title (#10)\nhttps://github.com/foo/parent/pull/10\n\nParent PR summary',
    'foo/child': 'Child PR title\n\n**some-bolded-thing**\nblahblah',
  });
});
