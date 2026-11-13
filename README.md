# api-extractor-effect

[![CI](https://img.shields.io/github/actions/workflow/status/systemfsoftware/api-extractor-effect/ci.yml?branch=main&label=CI)](https://github.com/systemfsoftware/api-extractor-effect/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

`@systemfsoftware/api-extractor` reads a TypeScript package's public API, compares two versions of it, and tells you the semver bump the change needs. It understands Effect: adding a tagged error to the `E` channel of a function that returns an `Effect` is a major bump, because callers must now handle the new error. Every output is byte-identical across locales, time zones and hosts.

## Example

### The change

A package adds a failure to one function:

```diff
+export class Timeout { readonly _tag = 'Timeout' }
-export declare const loadUser: (id: string) => Effect.Effect<User, NotFound>
+export declare const loadUser: (id: string) => Effect.Effect<User, NotFound | Timeout>
```

### Judge both versions

Read both versions of the package and judge them:

```ts
import { NodeServices } from '@effect/platform-node'
import { FrontEnd, Verdict } from '@systemfsoftware/api-extractor'
import { Effect, Layer } from 'effect'

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(
  Layer.provideMerge(NodeServices.layer),
)

const modelOf = (packageRoot: string) =>
  FrontEnd.readPackage({ packageRoot }).pipe(Effect.flatMap(FrontEnd.analyse), Effect.map((analysis) => analysis.model))

const program = Effect.gen(function*() {
  const before = yield* modelOf('before/my-lib')
  const after = yield* modelOf('after/my-lib')
  process.stdout.write(yield* Verdict.cell.run({ before, after }))
}).pipe(Effect.provide(emitters))

await Effect.runPromise(program)
```

### The verdict document

The output is canonical JSON, here from a package whose `package.json` exports `./src/mod.ts` under the `@systemfsoftware/source` condition:

```json
{
  "_tag": "Verdict",
  "bump": "major",
  "corpusVersion": "1.1.0",
  "declarations": {
    "after": "oxc-transform@0.150.0",
    "before": "oxc-transform@0.150.0"
  },
  "engine": "@systemfsoftware/api-extractor@0.1.0",
  "findings": [
    {
      "bump": "major",
      "locations": [
        ".:loadUser/returns/E"
      ],
      "next_action": "Declare a major bump: callers must now handle the new error, or remove it from the error channel.",
      "reason_code": "E_WIDENED",
      "rule_id": "e-widened-out"
    },
    {
      "bump": "minor",
      "locations": [
        ".:Timeout"
      ],
      "next_action": "Declare at least a minor bump.",
      "reason_code": "EXPORT_ADDED",
      "rule_id": "export-added"
    }
  ],
  "schemaVersion": 1
}
```

## Install

`@systemfsoftware/api-extractor` is not on npm. This repository ships it as a flake output, and a release is a git tag and a GitHub Release (the latest is [v0.1.0](https://github.com/systemfsoftware/api-extractor-effect/releases/tag/%40systemfsoftware%2Fapi-extractor%40v0.1.0)). A consumer takes the flake as an input and the tarballs through the route in [pnpm-release-management](https://github.com/systemfsoftware/pnpm-release-management#distribution-through-nix). `nix.systemfsoftware.com` is the registry for `@systemfsoftware` packages: Nix fetches what a producer has pushed there and builds the rest from source. This repository pushes its own tarball on every push to `main`, so Nix substitutes `api-extractor` from `nix.systemfsoftware.com`.

### Add the flake as an input

```nix
{
  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
  };
  inputs = {
    nixpkgs.follows = "producer/nixpkgs";
    producer.url = "github:systemfsoftware/api-extractor-effect/<rev>";
    pnpm-release-management.url = "github:systemfsoftware/pnpm-release-management";
  };
}
```

### Build the tarballs and the pnpm store

```nix
packages = forEachSystem (pkgs: rec {
  producer-tarballs = pnpm-release-management.lib.mkProducerTarballs {
    inherit pkgs;
    producers = { inherit producer; };
  };
  pnpm-store = pnpm-release-management.lib.mkPnpmConsumerStore {
    inherit pkgs;
    src = self;
    files.".deps" = producer-tarballs;
  };
});
```

### Requirements

The package needs Node 24 or later and has `effect` `^4.1.2` as a peer, which installs from npm as usual:

```bash
pnpm add 'effect@^4.1.2'
```

## The verdict

`bump` is `none`, `patch`, `minor` or `major`. Each finding names the rule that fired, a reason code, the bump it needs, what to do next, and the places in the model it applies to. A model that does not decode fails the cell with `SurfaceRejected`, and a rule corpus in which two rules match the same change fails it with `RuleCorpusRejected`. The decision itself, `Verdict.judge`, is a pure `effect-cell-types` workflow over decoded values.

Rules are data. [`corpus.v1.json`](packages/api-extractor/src/rules/corpus.v1.json) holds 61 rules over 33 kinds of change; each maps a kind, its position (`in`, `out`, `both`), its Effect channel and its direction (`widened`, `narrowed`, `changed`) to a bump. The most specific matching rule wins, and a change no rule covers is reported as major `UNCLASSIFIED_CHANGE`.

| Change to a function | Reason code | Bump |
| --- | --- | --- |
| A tagged error joins the returned `E` channel | `E_WIDENED` | major |
| A tagged error leaves the returned `E` channel | `E_TAG_REMOVED` | major |
| The `E` channel of a parameter widens | `E_WIDENED_IN_INPUT` | minor |
| The `E` channel of a parameter narrows | `E_NARROWED_IN_INPUT` | major |

A removed tag is major because a caller's `catchTag` for that tag stops compiling.

## Reading a package's API

`FrontEnd.readPackage` finds a package's entry points through the `@systemfsoftware/source` export condition, and `FrontEnd.analyse` builds the API model from the declarations. It emits them on a fast path with `oxc-transform`'s isolated declarations, and falls back to the TypeScript 7 compiler when a package's exports are not annotated. Both routes give the same model apart from the producer stamp. The entry-point rules, the two routes and every refusal are in [docs/front-ends.md](docs/front-ends.md).

## Status

| Part | State |
| --- | --- |
| Versioned model, canonical serialiser, diff, rule corpus and verdict | released |
| Front-ends: isolated-declarations fast path, TypeScript 7 compiler fallback, model builder, analysis messages | released in 0.1.0 |
| `.api.md` report with a differential test against `@microsoft/api-extractor` 7.59.1 | planned |
| Benchmark, CLI, changeset-bump check | planned |

The design and its requirements are in [`docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`](docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md).

## Repository

| Path | What it is |
| --- | --- |
| [`packages/api-extractor`](packages/api-extractor) | `@systemfsoftware/api-extractor`, the library |
| [`apps/api-extractor-e2e`](apps/api-extractor-e2e) | Private. Checks that the library's outputs are byte-identical across locales and hosts |
| [`apps/api-extractor-profile`](apps/api-extractor-profile) | Private. Reproduces the per-phase profile behind the fast-path choice, kept in [`docs/profiles`](docs/profiles) |

## FAQ

**`Cannot find native binding` when importing the package.**
`oxc-parser` and `oxc-transform` load their native bindings when the package is imported. Install with optional dependencies, on a platform they ship for.

**`CompilerRejected` for a package that needs the fallback.**
The fallback runs TypeScript 7's native compiler, which the `typescript` package installs for the host platform as an optional dependency. Without it, every package that needs the fallback is refused, and the diagnostic names the missing platform package.

**`NoSourceEntry`.**
No export of the package has an `@systemfsoftware/source` condition that names a source file. Pass another condition, for example `FrontEnd.readPackage({ packageRoot, sourceCondition: 'types' })`.

**`UnsupportedDeclaration`.**
The package's declarations contain a construct the model cannot hold. The error names the file and the construct; the full list is in [docs/front-ends.md](docs/front-ends.md).

**`SurfaceRejected` from `Verdict.cell.run`.**
One of the two models does not decode as an API model. Produce models with `FrontEnd.analyse`, or check them against `ApiModel.decode`.

## Documentation

- [docs/front-ends.md](docs/front-ends.md): reading a package, the two routes and the refusals
- [docs/plans](docs/plans): the design and its requirements
- [docs/profiles](docs/profiles): the per-phase profile behind the fast path
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, checks and provenance

## Contributing

Development setup and checks: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). The behaviour is checked against `@microsoft/api-extractor` 7.59.1, whose notice is reproduced in the same file.
