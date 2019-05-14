import octokitGraphqlWithDefaults from '@octokit/graphql/lib/with-defaults';
import Octokit from '@octokit/rest';

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
export default github;
