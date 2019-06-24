# probot-app-monorepo-sync

[![Build Status](https://badge.buildkite.com/e11ea6abd3bec27ca72ed7c9c437be773d7878dc351ad9f7cd.svg)](https://buildkite.com/uberopensource/probot-app-monorepo-sync)

> A GitHub App built with [Probot](https://github.com/probot/probot) that keeps parent and child monorepos in sync

**NOTE**: The Github API has a limit of returning 100,000 tree items (i.e. files or folders), so this cannot support monorepos that exceed that amount of files and folders

## Configure

See `.env.example` for the environment variables supported for configuring the bot

## Comment commands

These commands can be triggered by posting a comment on the PR you wish to run the command on.

#### `!resync`

Since the syncing of rebases and merges isn't yet perfect, there are still times in which a secondary PR can get into a broken state (most commonly, the diff will have a lot more files changed than it should).

In this case, post `!resync` on either of the PRs, and it will re-copy the commits from the primary PR to the secondary PR and force push. This is basically the equivalent to closing both PRs and remaking a new one
