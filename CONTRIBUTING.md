# Contributing

## Development setup

`nix develop` provides the dev shell. nix.systemfsoftware.com is the package registry for `@systemfsoftware` packages: this repository takes them from its flake inputs, pinned to producer commits, and the dev shell copies them into `.deps/`.

Run the checks through the dev shell:

```sh
nix develop --command pnpm run bootstrap
nix develop --command pnpm test
nix develop --command pnpm lint
nix develop --command pnpm typecheck
```

`bootstrap` installs inside the pnpm-release-management sandbox.

## Reproducing the front-end profile

The fast-path emitter was chosen from a per-phase profile on systemfsoftware's public packages, [`docs/profiles/2026-10-12-front-end-phases.md`](docs/profiles/2026-10-12-front-end-phases.md). To reproduce it, check out systemfsoftware at the commit the profile names, install it with `pnpm install --frozen-lockfile --ignore-scripts`, and run:

```sh
nix develop --command pnpm --filter api-extractor-profile profile <systemfsoftware checkout> ../../docs/profiles/<date>-front-end-phases
```

## Provenance

This repository is MIT-licensed. The behaviour oracle is `@microsoft/api-extractor`
7.59.1 (`microsoft/rushstack` `apps/api-extractor` at
`bc4cd29cc4984cef267437565bf681582948285e`), whose MIT notice is reproduced in
[`LICENSE`](LICENSE). A file derived from upstream, or from systemfsoftware PR #552,
names its origin (repository, path and commit) in a header comment. No file in the
current tree is derived from either.
