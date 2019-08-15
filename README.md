# probot-app-uSync

[![Build Status](https://badge.buildkite.com/e11ea6abd3bec27ca72ed7c9c437be773d7878dc351ad9f7cd.svg?branch=master)](https://buildkite.com/uberopensource/probot-app-usync)

> A Probot implementation of [uSync](https://github.com/uber-workflow/usync)

## Monorepo setup

**.github/pull_request_template.md**

````md
<!-- DO NOT MODIFY THE FORMAT OF THIS BODY -->

## Summary

<!-- Replace this with your own summary -->
*No summary provided*

## Commit message overrides

<!--
  The landed commit message for this change will be `[PR title]\n\n[PR summary]`.
  Provide overrides of this message for externally synced repos below.

  Example:
  **foo/bar**
  ```
  My change to foo/bar

  This needed to be done for [reasons]. It was achieved by [ways].
  ```
-->

**foo/child-repo**
````

## Environment vars

`GH_TOKEN`

Account with access to all orgs involved in syncing

`USYNC_PARENT_REPO`

Name of the parent monorepo

## Comment commands

These commands can be triggered by posting a comment on the PR you wish to run the command on.

#### `!import`

Import a pull request from an external repo into the monorepo. This should be considered equivalent to merging, as the external pull request will be closed, and any further changes will happen in the monorepo's generated pull request.

#### `!land`

Land a pull request from the monorepo into it and any configured external repos. This applies not only to imported pull requests, but also those authored directly from the monorepo.
