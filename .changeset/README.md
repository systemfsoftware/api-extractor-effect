# Change intents

One file per change, read by pnpm-release-management's release tools. Author
one with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A pull request that changes a publishable package's path ships an intent
  here; the changeset check fails without one.
- `@systemfsoftware/api-extractor` is `private` until its first release, so
  the check asks no intent of it and Release neither tags nor releases it. The
  pull request that makes it public names its first non-`none` bump. Before it
  lands, either the remote tag `@systemfsoftware/api-extractor@v0.0.0` is
  deleted or the same release PR moves the version off 0.0.0: a public 0.0.0
  whose tarball differs from the tagged one refuses with
  `tag-integrity-mismatch`.
- `none` records a change that needs no release. A `none` on a change a
  consumer can see is the silent non-release the check exists to catch.
- The release PR consumes pending intents with `pnpm version -r`, writes each
  package's `CHANGELOG.md` (`versioning.changelog.storage: repository` in
  `pnpm-workspace.yaml`) and records the consumed intents in `ledger.yaml`.
- A release is a `<pkg>@vX.Y.Z` tag and a GitHub Release. Nothing is published
  to npm.
- This README is not an intent: an intent's frontmatter parses as
  `"<pkg>": <none|patch|minor|major>`.
