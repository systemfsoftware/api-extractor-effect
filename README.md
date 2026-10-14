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
`.ts`, `.tsx`, `.mts` or `.cts` file, or a hand-written `.d.ts`, `.d.mts` or `.d.cts`
file, as an entry point; `readPackage({ packageRoot,
sourceCondition })` reads another condition instead, for example `types` for a package
whose sources are not under the family's condition. A subpath pattern (`"./*"`, one
star) expands to one entry per matching source under Node's `exports` rules: an explicit
subpath wins over a pattern, and an export path belongs to the pattern key Node picks for
it, so it names no entry when that key's target has no source or is `null`. A key with two
stars names no entry. The condition is read where the family writes it, directly
under an export path, and its value is the source's path; a target that nests it under
another condition, lists targets in an array, or gives the condition anything but a path
names no entry. A package with no such export is refused with `NoSourceEntry`.
A package whose `package.json` does not decode — invalid JSON, or a manifest the schema
refuses — is refused with `ManifestRejected`, naming the package root. So is a pattern
export whose walk lists more than 1024 directories, which symlinked aliases of a
directory can reach by fanning out. The walk enters only directories the pattern's
prefix can lead to, never a symlink back to an ancestor, and never a `node_modules`
directory no export name could pass through.
A `package.json`
that is missing or cannot be read fails with the file system's `PlatformError`, as every
operation here does on an I/O fault.
`analyse` first emits declarations with `oxc-transform`'s isolated-declarations emitter,
which never type-checks. If any source an entry point reaches needs the checker (an
unannotated export, TS9xxx), or an entry cannot be proven from its own file (its source is
missing, lies outside the package, or shares a declaration path with another entry, or an
import names no file), the package takes the fallback. This package's own TypeScript 7
`tsc` runs as a process on a config that extends the package's tsconfig with a fixed emit
policy (`FrontEnd.compilerEmitPolicy`), and `route` is `Fallback` with the diagnostics that
sent it there. A `tsc` that fails refuses the package with `CompilerRejected`, whose
diagnostics come from the TypeScript 7 API. Only when the API reports no error (a write
failure, say) does the refusal carry one diagnostic with `tsc`'s exit code and printed
output, which a package's own file names and import specifiers can spell, so a consumer
treats that message as untrusted text. A `Reported` diagnostic is one the compiler
reported, carrying its `TSxxxx` code; a `Note` is a refusal reason no compiler reported, so
it carries no code. Either names a `file` only when that file is inside the package. A
refusal of an entry point names the entry's recorded source, which may lie outside the
package. The fallback runs TypeScript 7's native compiler, which the `typescript` package
installs for the host platform as an optional dependency. Installed without optional
dependencies, or on a platform TypeScript 7 does not ship for, every package that needs
the fallback is refused with `CompilerRejected`, whose one diagnostic carries `tsc`'s
message naming the missing platform package.
Both routes meet at declaration text: one syntactic builder makes the model and one
resolver reports `ae-forgotten-export`, `ae-missing-release-tag`,
`ae-internal-missing-underscore`, `ae-incompatible-release-tags` and
`ae-internal-mixed-release-tag`, so both routes give the same model and messages, apart
from the producer stamp (`producer.declarations`), which names the emitter that ran
(`FrontEnd.OXC_TRANSFORM_PRODUCER` or `FrontEnd.TYPESCRIPT_PRODUCER`).

The builder refuses a package with `UnsupportedDeclaration`, naming the file and the
construct, when its declarations contain one of these constructs, which model schema
version 2 cannot hold. The compiler fallback refuses the same way when a declaration it
emitted imports a relative path that names no declaration file inside the package. This
is the whole list:

- a destructuring declaration or parameter, a variable without a type or with an
  initialiser that is not a literal, `import x = require(...)`, `export as namespace`
  and `export default` of an expression
- an entry point that re-exports a name from another package (`export { it } from 'vitest'`).
  The whole package is refused, not just that export.
- an export list naming a name that no declaration holds (`export { present, Missing }` with
  no `Missing`), which happens only with declaration text written by hand
- `declare global`, module augmentation (`declare module 'vitest'`) and a dotted
  namespace (`declare namespace A.B`)
- `export =`
- an import type that names a module without a member (`typeof import('./x.js')`)
- an enum member whose declared value is computed rather than a literal, for example a
  hand-written `.d.ts` with `Write = 1 << 1`, and an enum member declared twice across
  merged declarations of one enum. Both emitters write constant members as literals and
  `tsc` refuses a repeated member, so these happen only with declaration text written by hand.
- an index signature without a parameter, a computed member or method name other than a
  literal or a dotted name (`[Symbol.iterator]` is kept), an enum member named by neither
  an identifier nor a string, a heritage clause that is not a name (`extends
  mixin(Base)`), a type node the printer has no form for, and text that does not parse as
  a declaration file

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
