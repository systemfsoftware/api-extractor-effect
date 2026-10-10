# Change intents

One file per change, read by pnpm-release-management's release tools. Author
one with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A pull request that changes a package path ships an intent here; the
  changeset check fails without one.
- `none` records a change that needs no release. A `none` on a change a
  consumer can see is the silent non-release the check exists to catch.
- The release PR consumes pending intents with `pnpm version -r`, writes each
  package's `CHANGELOG.md` (`versioning.changelog.storage: repository` in
  `pnpm-workspace.yaml`) and records the consumed intents in `ledger.yaml`.
- A release is a `<pkg>@vX.Y.Z` tag and a GitHub Release. Nothing is published
  to npm.
- This README is not an intent: an intent's frontmatter parses as
  `"<pkg>": <none|patch|minor|major>`.
