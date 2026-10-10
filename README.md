# api-extractor-effect

`@systemfsoftware/api-extractor` is a public-API tool for Effect-heavy TypeScript
libraries. It reduces a package to one versioned JSON API model, diffs two models,
and gives a semver verdict that understands Effect's `A`/`E`/`R` channels and dual
APIs. Every output is byte-identical across locales, time zones and hosts.

The design and its requirements live in
[`docs/plans/2026-10-10-1111-feat-effect-api-extractor-plan.md`](docs/plans/2026-10-10-1111-feat-effect-api-extractor-plan.md).

## Status

| Part | State |
|---|---|
| Versioned model, canonical serialiser, diff, rule corpus and verdict | in this repository |
| Front-ends (isolated-declarations fast path, compiler fallback) | next |
| `.api.md` report with a differential test against `@microsoft/api-extractor` 7.59.1 | planned |
| Benchmark, CLI, changeset-bump check | planned |
| systemfsoftware and stryker-js-effect packages from the flake (`.sfs-deps`) | in this repository |
| Lint, typecheck, build and test on systemfsoftware's reusable checks; tsdown, vitest and lint presets | in this repository |
| Releases: changesets and GitHub Releases through pnpm-release-management | in this repository |
| Mutation testing on `main` | waits on systemfsoftware's reusable mutation workflow (#710) |

## The verdict

```ts
import { Effect } from 'effect'
import { Verdict } from '@systemfsoftware/api-extractor'

// `before` and `after` are encoded API models (the JSON this tool writes).
const document = await Effect.runPromise(Verdict.cell.run({ before, after }))
process.stdout.write(document) // canonical JSON: { _tag, schemaVersion, engine, corpusVersion, declarations, bump, findings }
```

`bump` is `none`, `patch`, `minor` or `major`; each finding is
`{ rule_id, reason_code, bump, next_action, locations }`. A model that does not decode
fails the cell with `SurfaceRejected`; a rule corpus in which two rules match the same
change fails it with `RuleCorpusRejected`. The decision itself, `Verdict.judge`, is a
pure `effect-cell-types` workflow over decoded values.

Rules are data: [`src/rules/corpus.v1.json`](packages/api-extractor/src/rules/corpus.v1.json)
maps each kind of change, its position (`in`, `out`, `both`), its Effect channel and
its direction (`widened`, `narrowed`, `changed`) to a bump. The most specific matching
rule wins. A change no rule covers is reported as major `UNCLASSIFIED_CHANGE`.

For example, a function returning `Effect<User, NotFound>` that now returns
`Effect<User, NotFound | Timeout>` is major `E_WIDENED`; the same change to a parameter
is minor `E_WIDENED_IN_INPUT`. Removing a tagged error from a returned error channel is
major `E_TAG_REMOVED`, because a caller's `catchTag` for that tag stops compiling.

## Development

The `@systemfsoftware/*` packages install from tarballs that this repository's flake
builds from pinned systemfsoftware and stryker-js-effect commits, never from a registry.
The dev shell copies them into `.sfs-deps/`; `bootstrap` installs inside the
pnpm-release-management sandbox:

```sh
nix develop --command pnpm run bootstrap
nix develop --command pnpm test
nix develop --command pnpm lint
nix develop --command pnpm typecheck
```

## Provenance

This repository is MIT-licensed. The behaviour oracle is `@microsoft/api-extractor`
7.59.1 (`microsoft/rushstack` `apps/api-extractor` at
`bc4cd29cc4984cef267437565bf681582948285e`), whose MIT notice is reproduced in
[`LICENSE`](LICENSE). A file derived from upstream, or from systemfsoftware PR #552,
names its origin (repository, path and commit) in a header comment. No file in the
current tree is derived from either.
