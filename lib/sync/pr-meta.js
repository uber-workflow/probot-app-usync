/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {request} from '../github.js';
import {getPRFromNumber} from '../graphql.js';
import {getRelation} from '../relationships.js';

/**
 * @typedef {{
 *   number: number,
 *   repoName: string,
 * }} PROptType
 */

/**
 * @param {string} body
 * @returns {object}
 */
// this is messy, but I wanted it to be really forgiving on
// whitespace/formatting; maybe cleanup sometime
export function parsePRMeta(body) {
  const result = {};

  for (const comment of body.replace(/\r\n|\r/g, '\n').split('<!--')) {
    if (comment.includes('meta:')) {
      const lines = comment
        .split('\n')
        .filter(line => line && !/^ *#/.test(line));
      let currentKey, buffer;

      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('meta:')) continue;

        const hasTerminator = line.includes('-->');
        line = line.replace('-->', '');

        if (line) {
          if (/^\w+ *:/.test(line)) {
            const [, key, content] = /(\w+) *: *(.+)?/.exec(line);

            if (currentKey) {
              result[currentKey] = buffer || '';
            }

            currentKey = key;
            buffer = content || '';
          } else {
            buffer += '\n' + line;
          }
        }

        if (hasTerminator) break;
      }

      if (buffer) result[currentKey] = buffer;
      break;
    }
  }

  return result;
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<void>}
 */
export async function syncMeta(primaryPR, secondaryPR) {
  const repoRelation = getRelation(primaryPR.repoName, secondaryPR.repoName);
  let [
    {body: primaryBody, title: primaryTitle},
    {body: secondaryBody, title: secondaryTitle},
  ] = await Promise.all([
    getPRFromNumber('{body, title}', primaryPR, 'repository.pullRequest'),
    getPRFromNumber('{body, title}', secondaryPR, 'repository.pullRequest'),
  ]);

  if (repoRelation === 'parent') {
    const meta = parsePRMeta(primaryBody);

    if (meta.publicTitle) {
      if (meta.publicTitle !== 'MATCH') {
        primaryTitle = meta.publicTitle;
      }
    } else {
      // this is really just a safety net in case someone forgets to provide the meta
      primaryTitle = 'Sync pull request from parent repo';
    }

    primaryBody = meta.publicBody || '';
  }

  if (primaryBody !== secondaryBody || primaryTitle !== secondaryTitle) {
    const data = {};

    if (primaryBody !== secondaryBody) data.body = primaryBody;
    if (primaryTitle !== secondaryTitle) data.title = primaryTitle;

    await request('PATCH /repos/:repoName/pulls/:number', {
      number: secondaryPR.number,
      repoName: secondaryPR.repoName,
      data,
    });
  }
}
