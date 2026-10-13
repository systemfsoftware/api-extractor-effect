# Change intents

One file per change, read by pnpm-release-management's release tools. Author
one with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A pull request whose head moves a publishable package's turbo `build` hash
  from the base ships an intent naming that package (`release.jsonc` `gate`);
  the changeset check fails without one. Files outside the package move that
  hash too: `turbo.json`'s `build` task or `globalEnv`, and the root
  `package.json`'s dependencies. Such a pull request names the package, with
  `none` when its tarball does not change.
- `none` records a change that needs no release. A `none` on a change a
  consumer can see is the silent non-release the check exists to catch.
- `@systemfsoftware/api-extractor` is at 0.0.0 and the tag
  `@systemfsoftware/api-extractor@v0.0.0` exists. While both hold, a pull
  request that changes its tarball ships a non-`none` intent for it, because a
  `none` on a change to its tarball makes Release refuse with
  `tag-integrity-mismatch`. The tag is deleted only in the change that moves
  the version off 0.0.0.
- The release PR consumes pending intents with `pnpm version -r`, writes each
  package's `CHANGELOG.md` (`versioning.changelog.storage: repository` in
  `pnpm-workspace.yaml`) and records the consumed intents in `ledger.yaml`.
- A release is a `<pkg>@vX.Y.Z` tag and a GitHub Release. Nothing is published
  to npm.
- This README is not an intent: an intent's frontmatter parses as
  `"<pkg>": <none|patch|minor|major>`.
