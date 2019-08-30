# probot-app-uSync

[![Build Status](https://badge.buildkite.com/e11ea6abd3bec27ca72ed7c9c437be773d7878dc351ad9f7cd.svg?branch=master)](https://buildkite.com/uberopensource/probot-app-usync)

> A Probot implementation of [uSync](https://github.com/uber-workflow/usync)

## Monorepo setup

In addition to the [uSync setup](https://github.com/uber-workflow/usync#setup-your-monorepo), add this pull request template:

**.github/pull_request_template.md**

````md
<!-- DO NOT MODIFY THE FORMAT OF THIS BODY -->

## Summary

<!-- Replace this with your own summary -->
*No summary provided*

## Commit message overrides

<!--
  More info:
  https://github.com/uber-workflow/probot-app-usync#commit-messages

  Example:
  **foo/child-repo**
  ```
  My commit title

  My commit summary
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

By default, this will require at least one PR approval. To circumvent this, you can add the `breakglass` label to your PR.

## Commit messages

By default, when landing changes, the commit message used for external repos will be the same as the message for the parent repo (pull request title and summary). You may, however, want to provide a specific commit message for external repos.

For example, perhaps you've authored a change in the parent monorepo that spans across multiple synced directories. The default commit message would likely describe all the changes made across the monorepo, but that wouldn't make sense in the context of an external repo; you'd likely want the message for that repo to only describe changes made to its directory.

#### Override format

As seen in the pull request template [above](#monorepo-setup), commit message overrides can be provided under the `Commit message overrides` heading via the bolded repo name followed by a code block containing the entire message:

````md
**[REPO NAME]**
```
My commit title

My commit summary
```
````

## License

[MIT](LICENSE)
