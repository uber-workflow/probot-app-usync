const octokitGraphqlWithDefaults = require('@octokit/graphql/lib/with-defaults');
const Octokit = require('@octokit/rest');

const github = new Octokit({
  auth: `token ${process.env.GH_TOKEN}`,
});

// mimics probot's `context.github`
// https://github.com/probot/probot/blob/9265609/src/github/graphql.ts
github.graphql = octokitGraphqlWithDefaults(github.request, {
  method: 'POST',
  url: '/graphql',
});

// shared client with access to all the repos
module.exports = github;
