# api-extractor-effect

`@systemfsoftware/api-extractor` is a public-API tool for Effect-heavy TypeScript
libraries. It reduces a package to one versioned JSON API model, diffs two models,
and gives a semver verdict that understands Effect's `A`/`E`/`R` channels and dual
APIs. Every output is byte-identical across locales, time zones and hosts.

The design and its requirements live in
[`docs/plans/2026-10-10-0205-feat-effect-api-extractor-plan.md`](docs/plans/2026-10-10-0205-feat-effect-api-extractor-plan.md).

## Status

| Part | State |
|---|---|
| Versioned model, canonical serialiser, diff, rule corpus and verdict | in this repository |
| Front-ends (isolated-declarations fast path, compiler fallback) | next |
| `.api.md` report with a differential test against `@microsoft/api-extractor` 7.59.1 | planned |
| Benchmark, CLI, changeset-bump check | planned |
| Toolchain integration (flake, release, mutation) | waits on shared family tooling |

## The verdict

```ts
import { decodeApiModel, serialiseVerdict, verdict } from '@systemfsoftware/api-extractor'

const result = verdict(decodeApiModel(before), decodeApiModel(after))
result.bump // 'none' | 'patch' | 'minor' | 'major'
result.findings // [{ rule_id, reason_code, bump, next_action, locations }]
process.stdout.write(serialiseVerdict(result))
```

Rules are data: [`src/rules/corpus.v1.json`](packages/api-extractor/src/rules/corpus.v1.json)
maps each kind of change, its position (`in`, `out`, `both`), its Effect channel and
its direction (`widened`, `narrowed`, `changed`) to a bump. The most specific matching
rule wins. A change no rule covers is reported as major `UNCLASSIFIED_CHANGE`.

For example, a function returning `Effect<User, NotFound>` that now returns
`Effect<User, NotFound | Timeout>` is major `E_WIDENED`; the same change to a parameter
is minor `E_WIDENED_IN_INPUT`. Removing a tagged error from a returned error channel is
major `E_TAG_REMOVED`, because a caller's `catchTag` for that tag stops compiling.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
```

## Provenance

This repository is MIT-licensed. The behaviour oracle is `@microsoft/api-extractor`
7.59.1 (`microsoft/rushstack` `apps/api-extractor` at
`bc4cd29cc4984cef267437565bf681582948285e`), whose MIT notice is reproduced in
[`LICENSE`](LICENSE). A file derived from upstream, or from systemfsoftware PR #552,
names its origin (repository, path and commit) in a header comment. No file in the
current tree is derived from either.
