---
title: The compiler fallback inherits the package tsconfig's emit options, so the adapter pins every option that changes declaration text
date: 2026-10-12
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
- `CompilerEmitter` runs TypeScript 7 `tsc -p <package tsconfig>`, so it takes every option
  the package sets unless its `compilerArguments` override that option on the command line.

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

`compilerArguments` in the TypeScript 7 adapter passes `--stripInternal false`, next to its
other pinned options (`--declaration`, `--emitDeclarationOnly`, `--declarationMap false`,
`--sourceMap false`, `--incremental false`, `--composite false`, `--rootDir`, `--outDir`).
A command-line flag overrides the tsconfig, so the package no longer controls the option.

The e2e journey "Both front-ends reduce a package to one model" now also analyses a temp
package whose tsconfig sets `stripInternal: true` and which exports
`/** @internal */ hidden`. It asserts byte equality between the routes and that `hidden` is
present. Without the flag the compiled model lacks `hidden`, and the journey fails.

The output location is part of the same policy. A tsconfig `declarationDir` overrides
`--outDir` for `.d.ts` files (TSConfig reference, `declarationDir`:
https://www.typescriptlang.org/tsconfig/#declarationDir; reproduced on TypeScript 7.0.2, where
`tsc -p` with the adapter's flags printed a `TSFILE:` line under the package's own `types`
directory). Before `compilerArguments` also passed `--declarationDir <outDir>`, the adapter
therefore wrote the package's declarations into that `types` directory, found nothing under
its temp `outDir`, and refused the package. The same journey now analyses a package whose
tsconfig sets `declarationDir: "types"`. It asserts byte equality between the routes and that
no `types` directory appears in the package.

## Architectural invariant

**Single emit policy.** The fast path's options are the declaration-emit policy. The
fallback adapter restates every option in that policy on the command line, so a package's
tsconfig cannot make the routes disagree on those options. Other tsconfig options still
reach the fallback, because `-p` loads the whole file. An option outside the policy that
changes declaration text must be added to both adapters, together with an equality case:

```
fallbackArgs = ['-p', tsconfig, ...emitPolicyAsFlags(FAST_PATH_OPTIONS), ...outputLocation]
```

## Prevention

- Change both adapters together. An option added to the fast path's `isolatedDeclarationSync`
  call is mirrored as a flag in `compilerArguments` in the same change.
- Give each pinned option an equality case built on a package that sets the opposite value
  and declares something the option acts on. A corpus that never trips the option makes the
  equality law vacuous.
- Pin every option that moves an emitted file, not only those that change its text. Each
  output-location flag (`--outDir`, `--declarationDir`) points at the adapter's scoped temp
  directory. Gate: the `wroteIntoPackage: false` assertion of the journey "Both front-ends
  reduce a package to one model" fails when a package is written to.
- Code smell to grep for: a `compilerArguments` list that lacks a flag for an option the fast
  path passes explicitly.

## Related

- `docs/plans/2026-10-12-2048-feat-front-ends-plan.md` (R3; U10 disposition #6)
- `docs/solutions/design-patterns/keyed-uniqueness-in-the-api-model-schema.md`: a law passes
  vacuously when its corpus lacks the triggering shape
