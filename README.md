# api-extractor-effect

`@systemfsoftware/api-extractor` is a public-API tool for Effect-heavy TypeScript
libraries. It reduces a package to one versioned JSON API model, diffs two models,
and gives a semver verdict that understands Effect's `A`/`E`/`R` channels and dual
APIs. Every output is byte-identical across locales, time zones and hosts.

The design and its requirements live in
[`docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`](docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md).

## Status

Shipped in this repository: the versioned model and its canonical serialiser, the diff, the rule corpus and the verdict, and both front-ends (the isolated-declarations fast path and the TypeScript 7 compiler fallback). Planned: an `.api.md` report with a differential test against `@microsoft/api-extractor`, a benchmark, a CLI, and a changeset bump check.

## Install

`@systemfsoftware/api-extractor` is not on npm. This repository ships it as a flake output (`release.yml` publishes a git tag and a GitHub Release, and no npm package). A consumer takes the flake as an input and the tarballs through the route in [pnpm-release-management](https://github.com/systemfsoftware/pnpm-release-management#distribution-through-nix); Nix fetches a tarball a producer has pushed to `nix.systemfsoftware.com` and builds the rest from source.

```nix
{
  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
    fallback = true;
  };
  inputs = {
    nixpkgs.follows = "producer/nixpkgs";
    producer.url = "github:systemfsoftware/api-extractor-effect/<rev>";
    pnpm-release-management.url = "github:systemfsoftware/pnpm-release-management";
  };
}
```

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

The package's peer, `effect` 4.x, installs from npm as usual:

```bash
pnpm add 'effect@^4'
```

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

## Reading a package's API

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

`readPackage` finds the entry points through the `@systemfsoftware/source` export condition, and `analyse` builds the model. The full entry-point rules, the two front-end routes and every refusal are in [docs/front-ends.md](docs/front-ends.md).

## Documentation

- [docs/front-ends.md](docs/front-ends.md): reading a package, the fast path and the compiler fallback, and the refusals
- [docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md](docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md): the design and its requirements
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, checks and provenance

## Contributing

Development setup and checks are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). The behaviour is checked against `@microsoft/api-extractor` 7.59.1, whose notice is reproduced in the same file.
