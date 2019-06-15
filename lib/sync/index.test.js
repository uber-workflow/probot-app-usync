/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  generateSecondaryBranchName,
  isSecondaryBranchName,
  parseSecondaryBranchName,
} from './index.js';

test(`generateSecondaryBranchName`, () => {
  expect(
    generateSecondaryBranchName({
      number: 10,
      repoName: 'foo/bar',
    }),
  ).toBe('foo/bar/10');
});

test(`isSecondaryBranchName`, () => {
  expect(isSecondaryBranchName('foo/bar/10')).toBe(true);
  expect(isSecondaryBranchName('foo')).toBe(false);
});

test(`parseSecondaryBranchName`, () => {
  expect(parseSecondaryBranchName('foo/bar/10')).toEqual({
    number: 10,
    repoName: 'foo/bar',
  });
});
