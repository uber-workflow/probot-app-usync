/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {getGroupedState} from './commit-status.js';

test('getGroupedState', () => {
  // error
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'MERGEABLE',
      statuses: [
        {
          context: 'foo',
          state: 'ERROR',
        },
        {
          context: 'bar',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('error');
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'CONFLICTING',
      statuses: [
        {
          context: 'foo',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('error');
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'UNKNOWN',
      statuses: [
        {
          context: 'foo',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('error');
  expect(
    getGroupedState({
      branchState: 'behind',
      mergeable: 'MERGEABLE',
      statuses: [
        {
          context: 'bar',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('error');

  // failure
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'MERGEABLE',
      statuses: [
        {
          context: 'foo',
          state: 'FAILURE',
        },
        {
          context: 'bar',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('failure');

  // pending
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'MERGEABLE',
      statuses: [
        {
          context: 'foo',
          state: 'PENDING',
        },
        {
          context: 'bar',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('pending');

  // success
  expect(
    getGroupedState({
      branchState: 'ahead',
      mergeable: 'MERGEABLE',
      statuses: [
        {
          context: 'foo',
          state: 'SUCCESS',
        },
        {
          context: 'bar',
          state: 'SUCCESS',
        },
      ],
    }),
  ).toBe('success');
});
