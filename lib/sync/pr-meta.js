/** Copyright (c) 2019 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {request} from '../github';
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
export function parsePRMetadata(body) {
  const result = {};

  for (let comment of body.replace(/\r\n|\r/g, '\n').split('<!--')) {
    comment = comment.slice(0, comment.indexOf('-->') + 3);

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
 * @param {string} body
 * @returns {string}
 */
export function stripPRMetadata(body) {
  let result = body.replace(/\r\n|\r/g, '\n');
  let metaComment;

  for (let comment of result.split('<!--')) {
    comment = '<!--' + comment.slice(0, comment.indexOf('-->') + 3);

    if (comment.includes('meta:')) {
      metaComment = comment;
      break;
    }
  }

  if (metaComment) {
    result = result.replace(metaComment, '').replace(/^\n+/, '');
  }

  return result;
}

/**
 * @typedef {{
 *   body: string,
 *   title: string,
 * }} MetaProps
 */
/**
 * @param {MetaProps} primaryMeta
 * @param {'child' | 'parent' | void} repoRelation
 * @returns {Promise<MetaProps>}
 */
export function generateSecondaryPRMeta(primaryMeta, repoRelation) {
  if (repoRelation === 'child') {
    // if primary pr is in the child repo, then secondary pr just mimics
    // the title/body of the primary
    return primaryMeta;
  } else {
    const metadata = parsePRMetadata(primaryMeta.body);
    const result = {
      body: '',
      title: null,
    };

    if (metadata.publicBody === 'MATCH') {
      result.body = stripPRMetadata(primaryMeta.body);
    } else if (metadata.publicBody) {
      result.body = metadata.publicBody;
    }

    if (metadata.publicTitle === 'MATCH') {
      result.title = primaryMeta.title;
    } else if (metadata.publicTitle) {
      result.title = metadata.publicTitle;
    } else {
      // this is really just a safety net in case someone forgets to provide the metadata
      result.title = 'Sync pull request from parent repo';
    }

    return result;
  }
}

/**
 * @param {PROptType} primaryPR
 * @param {PROptType} secondaryPR
 * @returns {Promise<void>}
 */
export async function syncMeta(primaryPR, secondaryPR) {
  let [primaryMeta, secondaryMeta] = await Promise.all([
    getPRFromNumber('{body, title}', primaryPR, 'repository.pullRequest'),
    getPRFromNumber('{body, title}', secondaryPR, 'repository.pullRequest'),
  ]);
  const expectedMeta = generateSecondaryPRMeta(
    primaryMeta,
    getRelation(primaryPR.repoName, secondaryPR.repoName),
  );

  if (
    secondaryMeta.body !== expectedMeta.body ||
    secondaryMeta.title !== expectedMeta.title
  ) {
    const data = {};

    if (secondaryMeta.body !== expectedMeta.body) data.body = expectedMeta.body;
    if (secondaryMeta.title !== expectedMeta.title)
      data.title = expectedMeta.title;

    await request('PATCH /repos/:repoName/pulls/:number', {
      number: secondaryPR.number,
      repoName: secondaryPR.repoName,
      data,
    });
  }
}
