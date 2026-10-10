# Change intents

One file per change, read by pnpm-release-management's release tools. Author
one with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A pull request that changes a publishable package's path ships an intent
  here; the changeset check fails without one.
- `none` records a change that needs no release. A `none` on a change a
  consumer can see is the silent non-release the check exists to catch.
- `@systemfsoftware/api-extractor` is at 0.0.0 and the tag
  `@systemfsoftware/api-extractor@v0.0.0` exists. While both hold, a pull
  request that changes `packages/api-extractor` ships a non-`none` intent for
  it, because a `none` on a change to its tarball makes Release refuse with
  `tag-integrity-mismatch`. The tag is deleted only in the change that moves
  the version off 0.0.0.
- The release PR consumes pending intents with `pnpm version -r`, writes each
  package's `CHANGELOG.md` (`versioning.changelog.storage: repository` in
  `pnpm-workspace.yaml`) and records the consumed intents in `ledger.yaml`.
- A release is a `<pkg>@vX.Y.Z` tag and a GitHub Release. Nothing is published
  to npm.
- This README is not an intent: an intent's frontmatter parses as
  `"<pkg>": <none|patch|minor|major>`.
