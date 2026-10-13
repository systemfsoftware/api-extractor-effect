# api-extractor-effect

`@systemfsoftware/api-extractor` is a public-API tool for Effect-heavy TypeScript
libraries. It reduces a package to one versioned JSON API model, diffs two models,
and gives a semver verdict that understands Effect's `A`/`E`/`R` channels and dual
APIs. Every output is byte-identical across locales, time zones and hosts.

The design and its requirements live in
[`docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`](docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md).

## Status

| Part | State |
|---|---|
| Versioned model, canonical serialiser, diff, rule corpus and verdict | in this repository |
| Front-ends (isolated-declarations fast path, TypeScript 7 compiler fallback, model builder, analysis messages) | in this repository |
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

## Front-ends

```ts
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(
  Layer.provideMerge(NodeServices.layer),
)

const analysis = await Effect.runPromise(
  FrontEnd.readPackage({ packageRoot: 'packages/my-lib' }).pipe(Effect.flatMap(FrontEnd.analyse), Effect.provide(emitters)),
)
process.stdout.write(ApiModel.serialise(analysis.model))
```

`readPackage` takes each export whose `@systemfsoftware/source` condition names a
`.ts`, `.tsx`, `.mts` or `.cts` file as an entry point. A subpath pattern (`"./*"`)
expands to one entry per matching source under Node's `exports` rules, and an explicit
subpath wins over a pattern. A package with no such export is refused with `NoSourceEntry`.
`analyse` first emits declarations with `oxc-transform`'s isolated-declarations emitter,
which never type-checks. If any source an entry point reaches needs the checker (an
unannotated export, TS9xxx), or an entry cannot be proven from its own file (its source is
missing, lies outside the package, or shares a declaration path with another entry, or an
import names no file), the package takes the fallback. This package's own TypeScript 7
`tsc` runs as a process on a config that extends the package's tsconfig with a fixed emit
policy (`FrontEnd.compilerEmitPolicy`), and `route` is `Fallback` with the diagnostics that
sent it there. A `tsc` that fails refuses the package with `CompilerRejected`, whose
diagnostics come from the TypeScript 7 API, never from `tsc`'s printed output, which a
package's own file names and import specifiers can spell. A diagnostic no compiler reported
(a missing entry, say) carries no TypeScript code.
Both routes meet at declaration text: one syntactic builder makes the model and one
resolver reports `ae-forgotten-export`, `ae-missing-release-tag`,
`ae-internal-missing-underscore`, `ae-incompatible-release-tags` and
`ae-internal-mixed-release-tag`, so both routes give the same model and messages, apart
from the producer stamp (`producer.declarations`), which names the emitter that ran
(`FrontEnd.OXC_TRANSFORM_PRODUCER` or `FrontEnd.TYPESCRIPT_PRODUCER`).

The builder refuses a package with `UnsupportedDeclaration`, naming the file and the
construct, when its declarations contain one of these constructs, which model schema
version 2 cannot hold:

- an entry point that re-exports a name from another package (`export { it } from 'vitest'`).
  The whole package is refused, not just that export.
- `declare global` and module augmentation (`declare module 'vitest'`)
- `export =`
- an enum member whose declared value is computed rather than a literal, for example a
  hand-written `.d.ts` with `Write = 1 << 1`. Both emitters write constant members as
  literals, so this happens only with declaration text written by hand.

One construct is not refused: `export * from 'effect'`, or `export *` from any other
package, adds no items to the model. The names it re-exports are missing from the model,
and a verdict does not see them change.

The fast-path emitter was chosen from a per-phase profile on systemfsoftware's public
packages, [`docs/profiles/2026-10-12-front-end-phases.md`](docs/profiles/2026-10-12-front-end-phases.md).
To reproduce it, check out systemfsoftware at the commit the profile names, install it
with `pnpm install --frozen-lockfile --ignore-scripts`, and run:

```sh
nix develop --command pnpm --filter api-extractor-profile profile <systemfsoftware checkout> ../../docs/profiles/<date>-front-end-phases
```

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
