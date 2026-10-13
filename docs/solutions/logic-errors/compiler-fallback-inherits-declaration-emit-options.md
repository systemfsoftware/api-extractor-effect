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
`stripInternal: false`, `removeComments: false`, `declaration`, `emitDeclarationOnly`,
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

Moving the policy into a derived config file exposed two settings whose defaults resolve from
the config file's directory, not the package's. Both were reproduced on TypeScript 7.0.2 with a
derived config in the temp directory:

- The default `typeRoots`: the `@types` folder of every `node_modules` directory from the config's directory upward. Extending this
  package's `tsconfig.build.json` (`types: ["node"]`) failed with TS2688 `Cannot find type
  definition file for 'node'`.
- The default `include` (`**/*`). A package tsconfig that names no `include` or `files` failed
  with TS18003 `No inputs were found in config file`, because `**/*` matched the temp
  directory.

The derived config therefore reads the package's config once with the TypeScript 7 API's
`parseConfigFile`. It sets `files` to the package config's resolved `fileNames`, and
`typeRoots` to the package's declared value or, when it declares none, the default chain from
the package root. Setting the default chain unconditionally would replace a package's declared
`typeRoots`. The journey's `typeRoots: ["./types"]` package fails that way. `paths` needed
nothing: a package declaring `paths: { "#lib/*": ["./lib/*"] }` compiled through the derived
config.

## Architectural invariant

**Single emit policy.** The fast path's options are the declaration-emit policy. The
fallback's derived config restates every option in that policy, so a package's tsconfig
cannot make the routes disagree on them. Every other tsconfig option still reaches the
fallback through `extends`, unless its default depends on the config file's location, in
which case the derived config carries the value the package's own config resolves to:

```
derived = { extends: packageTsconfig, files: packageFileNames, compilerOptions: { ...compilerEmitPolicy, typeRoots: declaredOrDefault } }
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
- A setting whose default resolves from the config file's directory is carried into the
  derived config with the value the package's config resolves to. Gate: the `typeRoots` and
  no-`include` cases of the same journey; each refuses on the fallback when its value is not
  carried.

## Related

- `docs/plans/2026-10-13-1834-feat-front-ends-plan.md` (R3; U10 disposition #6; U12 emit policy)
- `docs/solutions/design-patterns/keyed-uniqueness-in-the-api-model-schema.md`: a law passes
  vacuously when its corpus lacks the triggering shape
