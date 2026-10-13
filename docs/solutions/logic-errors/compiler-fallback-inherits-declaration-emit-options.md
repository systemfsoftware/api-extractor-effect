---
title: The compiler fallback inherits the package tsconfig's emit options, so the adapter pins every option that changes declaration text
date: 2026-10-12
last_updated: 2026-10-13
category: logic-errors
module: api-extractor front-ends (IsolatedEmitter and CompilerEmitter adapters)
problem_type: logic_error
component: front_end
symptoms:
  - "A package whose tsconfig sets `stripInternal: true` has an `@internal` export in its model on the fast path and loses it on the fallback"
  - The fast-vs-fallback equality journey stays green on this repository's package while the routes disagree elsewhere
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [front-ends, isolated-declarations, oxc-transform, tsc, strip-internal, model-equality, tsconfig]
---

# The compiler fallback inherits the package tsconfig's emit options

## Problem

Plan R3 says both routes give one package one model. The two `DeclarationEmitter` adapters
get their emit options from different places:

- `IsolatedEmitter` (oxc-transform `isolatedDeclarationSync`) passes a fixed option object
  that includes `stripInternal: false`, and it never reads the package's tsconfig.
- `CompilerEmitter` runs TypeScript 7 `tsc` on the package's tsconfig, so it takes every
  option the package sets unless the adapter overrides that option.

A package built with `stripInternal: true` therefore loses its `/** @internal */` exports
on the fallback and keeps them on the fast path. The same package gets two models, and which
one depends on the route it took.

## Failure mechanism

1. The model is a pure function of declaration text (KTD6):
   $\text{model} = \text{build}(\text{text}(\text{emit}(\text{options})))$.
2. Fast-path options are a code constant $O_c$. Fallback options are
   $O_c \oplus O_{\text{tsconfig}}$, the tsconfig merged under the command line.
3. For any option $o$ that changes the emitted text and that $O_c$ does not pin, a package
   with $O_{\text{tsconfig}}(o) \neq$ the fast path's behaviour produces different text, and
   so a different model.
4. The equality journey cannot detect this unless its corpus both sets $o$ and declares
   something $o$ acts on. This repository's own `tsconfig.build.json` sets
   `stripInternal: true` but declares nothing `@internal`, so the journey stayed green.

## Solution

The emit policy is one exported record, `compilerEmitPolicy` in the TypeScript 7 adapter:
`stripInternal: false`, `isolatedDeclarations: false`, `removeComments: false`, `declaration`, `emitDeclarationOnly`,
`declarationMap: false`, `sourceMap: false`, `incremental: false`, `composite: false`,
`tsBuildInfoFile: null`, `rootDir` (workspace root), and `outDir` and `declarationDir` (the
adapter's scoped temp directory). The adapter writes `{ "extends": <package tsconfig>,
"compilerOptions": <policy> }` into that directory and runs `tsc -p` on it. A key in the
extending file's `compilerOptions` overrides the extended file's, so the package no longer
controls those options. (Until U12 the same options were command-line flags. They moved
into a config file because the adapter stopped reading `tsc`'s stdout; see U12 C3 in the
plan.)

The e2e journey "Both front-ends reduce a package to one model" now also analyses a temp
package whose tsconfig sets `stripInternal: true` and which exports
`/** @internal */ hidden`. It asserts byte equality between the routes and that `hidden` is
present. Without `stripInternal: false` the compiled model lacks `hidden`, and the journey fails.

The output location is part of the same policy. A tsconfig `declarationDir` overrides
`outDir` for `.d.ts` files (TSConfig reference, `declarationDir`:
https://www.typescriptlang.org/tsconfig/#declarationDir; reproduced on TypeScript 7.0.2, where
the adapter wrote under the package's own `types` directory). Before the policy also set
`declarationDir`, the adapter wrote the package's declarations into that `types` directory,
found nothing under its temp output directory, and refused the package. The same journey now
analyses a package whose tsconfig sets `declarationDir: "types"`. It asserts byte equality
between the routes and that no `types` directory appears in the package.

`removeComments` is the second text-changing option found the same way. With it set, `tsc`
drops the `/** @public */` comment the message resolver reads its release tag from, so the
fallback reported `ae-missing-release-tag` for an export the fast path saw as tagged. The
adapter sets `removeComments: false`, and the journey analyses a package whose tsconfig
sets `removeComments: true` and asserts both routes give the same notes, and none.

Moving the policy into a derived config file exposed settings that resolve from the config
file's directory, not the package's. Each was reproduced on TypeScript 7.0.2 with a derived
config in a temp directory:

- The default `typeRoots`: the `@types` folder of every `node_modules` directory from the
  config's directory upward. Extending this package's `tsconfig.build.json` (`types: ["node"]`)
  failed with TS2688 `Cannot find type definition file for 'node'`.
- A `types` entry that names a package rather than an `@types` folder. `tsc` looks it up in the
  `node_modules` directories from the config's directory upward, honouring the package's
  `exports`. Four corpus packages that name `vitest/globals` (`effect-daemon-cluster` and three
  siblings) failed with TS2688 `Cannot find type definition file for 'vitest/globals'`, after
  an earlier profile had modelled them.
- The default `include` (`**/*`). A package tsconfig that names no `include` or `files` failed
  with TS18003 `No inputs were found in config file`, because `**/*` matched the temp
  directory.

The derived config is therefore written into a scoped mirror of the package config's
directory: every ancestor of that directory is recreated under the temp root, each with a
symlink to the real ancestor's `node_modules` where one exists. `tsc`'s upward `node_modules`
walk from the derived config then visits the same directories as from the package's own
config, so default `typeRoots` and `types` lookups resolve as they would from the package. A
declared `typeRoots` resolves against the config that declares it through `extends`. The
derived config sets `files` to the package config's resolved `fileNames`, read once with the
TypeScript 7 API's `parseConfigFile`. An earlier fix carried an explicit `typeRoots` chain
instead. It did not cover `types` packages, and with it in place the mirror still failed
TS2688 for `vitest/globals`. `paths` needed nothing: a package declaring
`paths: { "#lib/*": ["./lib/*"] }` compiled through the derived config.

The mirror follows `tsc`'s walk exactly, including its one exception: `tsc` never looks for a
`node_modules` inside a directory named `node_modules`. A mirrored ancestor named
`node_modules` therefore gets no symlink, and the mirrored segment is renamed. Without the
rename, a package installed at `<dir>/node_modules/<name>` made the mirror create
`<dir>/node_modules` as a real directory and then fail to symlink the same path
(`AlreadyExists`, reproduced through `CompilerEmitter`).

`isolatedDeclarations` changes whether `tsc` refuses, not what it prints. The fast path
declines a package with an unannotated export (`NotIsolated`, TS9010) and routes it to the
fallback. A package whose own tsconfig sets `isolatedDeclarations: true` made the fallback's
`tsc` raise the same TS9010, exit non-zero, and refuse the package with `CompilerRejected`,
so the route meant for that package could never analyse it (reproduced on TypeScript 7.0.2:
the same source gave a model with the flag off and `CompilerRejected` with it on). The
policy pins `isolatedDeclarations: false`, and the e2e TS9010 routing scenario analyses the
same package with the flag set and asserts the same fallback model.

## Architectural invariant

**Single emit policy.** The fast path's options are the declaration-emit policy. The
fallback's derived config restates every option in that policy, so a package's tsconfig
cannot make the routes disagree on them. Every other tsconfig option still reaches the
fallback through `extends`. A setting that resolves from the config file's location sees the
package's own `node_modules` ancestry through the mirror, and the root files are carried
explicitly:

```
derived at mirror(dirname(packageTsconfig)) = { extends: packageTsconfig, files: packageFileNames, compilerOptions: compilerEmitPolicy }
```

## Prevention

- Change both adapters together. An option added to the fast path's `isolatedDeclarationSync`
  call is added to `compilerEmitPolicy` in the same change.
- Give each pinned option an equality case built on a package that sets the opposite value
  and declares something the option acts on. A corpus that never trips the option makes the
  equality law vacuous.
- Pin every option that moves an emitted file, not only those that change its text. Each
  output-location option (`outDir`, `declarationDir`) points at the adapter's scoped temp
  directory. Gate: the `wroteIntoPackage: false` assertion of the journey "Both front-ends
  reduce a package to one model" fails when a package is written to.
- A setting that resolves from the config file's directory resolves through the mirrored
  `node_modules` ancestry, and the root files are carried as `files`. Gates, in the same
  journey: the `types: ["greeting/globals"]` case refuses on the fallback when the derived
  config sits outside the mirror, the package installed under `node_modules` fails with
  `AlreadyExists` when a mirrored `node_modules` segment keeps its name, the
  `typeRoots: ["./types"]` case refuses when a default chain replaces the declared one, and
  the no-`include` case when `files` is not carried.
- Pin every option that makes `tsc` refuse what the fast path routes to it. Gate: the e2e
  scenario "an export with an inferred type routes to the compiler" analyses a package that
  sets `isolatedDeclarations: true` and refuses on the fallback when the option is not pinned.

## Related

- `docs/plans/2026-10-13-2348-feat-front-ends-plan.md` (R3; U10 disposition #6; U12 emit policy; U13 #4, the mirrored `node_modules` ancestry and its delta ruling)
- `docs/solutions/design-patterns/keyed-uniqueness-in-the-api-model-schema.md`: a law passes
  vacuously when its corpus lacks the triggering shape
