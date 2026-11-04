---
title: Retain the tsgo override until the shared lint preset accepts the catalog version
date: 2026-11-04
category: build-errors
module: pnpm dependency resolution and oxlint preset
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - Updating Effect or the tsgo catalog version
  - Removing dependency overrides or validating lint preset upgrades
retire_when: "SYS-990 delivers a shared lint preset whose tsgo range accepts the catalog version; check the published preset manifest."
tags: [pnpm, tsgo, oxlint, dependency-resolution, turbo, lint]
---

# Retain the tsgo override until the shared lint preset accepts the catalog version

## Context

The shared `@systemfsoftware/oxlint-config-recommended` package imports the `correctness` and `recommended` presets from its own `@effect/tsgo` dependency. Version 4.0.0 declares that dependency as `^0.50.0`, which excludes the catalog's 0.64.1. The root tool version alone therefore does not guarantee which preset the shared configuration loads.

## Guidance

Retain the existing `@effect/tsgo` catalog override while the shared preset's dependency range excludes the catalog version. This is a pre-existing exception, not a general reason to force incompatible dependencies. The owner directed its retention during the 4.1.2 upgrade because removing it reduced lint coverage. The independent Effect and platform overrides were removed.

SYS-990 tracks the shared preset's range fix. Once an updated preset accepts the catalog version, remove the tsgo override, regenerate the lockfile, and run lint without cached results before deciding whether the exception is obsolete.

## Why This Matters

The lint rule set is a function of the version resolved **by the preset**, not just the root dependency:

`effective rules = shared preset(resolved transitive tsgo version)`

A successful lint run can hide a regression in lint coverage. In this upgrade, removing the override resolved tsgo 0.50.0 for the shared preset and produced 337 enabled rules. Restoring the override resolved 0.64.1 and produced 348 rules; the original baseline had 343. These counts are observations for this dependency set, not permanent thresholds or proof that individual rule semantics are identical.

## When to Apply

- Before removing an override that affects a lint preset, inspect both the preset's declared range and its actual lockfile resolution.
- Compare the enabled rules, not only lint's exit status. Investigate a reduction before accepting it.
- After changing dependency resolution, bypass the task cache when validating lint. A normal run in this session replayed the earlier 337-rule result even after the override was restored.

## Examples

The lockfile records `@effect/tsgo` 0.64.1 as a dependency of the shared preset, while the catalog override selects that version. Validate the resolved graph and execute checks in the development shell:

```sh
nix develop --command pnpm list --depth 0 --recursive
nix develop --command pnpm exec turbo run lint typecheck --force
```

Inspect the shared preset's lockfile snapshot as well as the direct dependency listing; the latter alone does not prove the preset's transitive resolution.

## Related

- `docs/solutions/build-errors/turbo-stale-cache-with-source-condition-dependencies.md` covers a distinct source-dependency cache-key failure; its transit-node remedy is not established as a fix for this override-resolution case.
