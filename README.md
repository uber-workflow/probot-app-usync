# probot-app-monorepo-sync

[![Build Status](https://badge.buildkite.com/e11ea6abd3bec27ca72ed7c9c437be773d7878dc351ad9f7cd.svg)](https://buildkite.com/uberopensource/probot-app-monorepo-sync)

> A GitHub App built with [Probot](https://github.com/probot/probot) that keeps parent and child monorepos in sync

**NOTE**: The Github API has a limit of returning 100,000 tree items (i.e. files or folders), so this cannot support monorepos that exceed that amount of files and folders
