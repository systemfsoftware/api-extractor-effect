---
title: Turbo replays a stale test result when a workspace dependency resolves through a source condition
date: 2026-10-10
category: build-errors
module: turbo task graph (turbo.json)
problem_type: build_error
component: tooling
symptoms:
  - The e2e app's turbo test task reports a cache hit with an unchanged hash after an edit to the api-extractor package's source
  - A dependent's tests replay an old pass instead of running against the edited dependency
root_cause: config_error
resolution_type: config_change
severity: high
tags: [turbo, cache, transit-node, source-condition, workspace-dependency, vitest]
---

# Turbo replays a stale test result when a workspace dependency resolves through a source condition

## Problem

The e2e app (`api-extractor-e2e`) tests `@systemfsoftware/api-extractor` from its source, not its build. The cache key of the e2e app's `test` task did not cover that source. After any edit to the package, turbo replayed the e2e app's last cached pass instead of running the tests again. Nothing fails, so a regression that only the e2e lane would catch passes until someone clears the cache or runs with `--force`.

## Symptoms

`pnpm turbo run test --filter=api-extractor-e2e` was run three times: once, again with no change, and once more after appending a newline to a source file of the package. All three printed the same line:

```text
api-extractor-e2e:test: cache hit, replaying logs f22a787bfac66a2f
```

## What Didn't Work

- Adding `^build` to `test`. This was ruled out, not tried. Under the plan (U13's approach), tests need no build. A `^build` edge would bring back a build that vitest never reads, just to get a hash edge.
- Listing the dependency's source globs in `test.inputs`. This was considered, not tried. Every task would carry its own hand-written copy of the workspace graph, and those copies go stale as soon as the dependency list changes.

## Solution

`turbo.json` gains a `transit` task that no workspace defines as a script. `transit` depends on itself upstream, and every task whose result reads dependency source depends on `transit`:

```json
"transit": {
  "dependsOn": ["^transit"]
},
"lint": {
  "dependsOn": ["transit"]
},
"test": {
  "dependsOn": ["transit"],
  "inputs": ["$TURBO_DEFAULT$", "vitest.config.ts"]
}
```

The same three runs now print the following:

```text
api-extractor-e2e:test: cache miss, executing 27f6fea4f7359853
api-extractor-e2e:test: cache hit, replaying logs 27f6fea4f7359853
api-extractor-e2e:test: cache miss, executing f4be7649b1427780
```

## Why This Works

1. **Hash composition.** A task's hash covers its own workspace's files plus the hashes of the tasks it depends on. That is the premise of turbo's documented transit-node pattern. A dependency's files reach the hash only through a task-graph edge. The `workspace:*` dependency edge did not move the key on its own, as the Symptoms runs show.
2. **The edge that went missing.** `@systemfsoftware/vitest-config` exports `sourceResolveConditions`, which adds the `@systemfsoftware/source` condition to vite's client and SSR resolve conditions, and `sharedConfig` spreads it. The package's `exports` map points that condition at its source entry module. So tests import source, `build` is never a real input to `test`, and once `^build` was dropped no edge was left.
3. **The transit edge.** `transit` has no script anywhere, so it runs nothing and produces no outputs. Its hash still covers its workspace's files and every upstream `transit` hash. `test` → `transit` → `^transit` therefore puts every transitive workspace dependency's files into the dependent's key, and tasks no longer wait on a build they never read.

**Invariant:** for every task T in workspace W, and every workspace D that T's result reads, T's key must depend on D's files:

$$\forall\, T \in W,\ \forall\, D \in \text{reads}(T):\ \text{files}(D) \subseteq \text{key}(T)$$

In turbo, this holds only if a `dependsOn` path runs from T to some task in D. Source-condition resolution makes `reads(T)` larger than the build graph, so the edge has to come from somewhere else. Here it comes from `transit`.

## Prevention

- Any new task whose output reads a workspace dependency's source depends on `transit`. That includes a new lane, a new `apps/*` consumer, and a typecheck that resolves `@systemfsoftware/source` through `customConditions`. Never leave such a task with no upstream edge.
- Do not delete `transit` because it has no script. It has no script on purpose.
- To check a cache key, run the task, append a newline to a source file of a dependency, and run it again. The second run must print `cache miss` with a new hash.

## Related Issues

- Plan: `docs/plans/2026-10-10-1111-feat-effect-api-extractor-plan.md`, U13 approach (tests resolve source through `@systemfsoftware/source`, so they need no build).
- Turbo's transit-node pattern: [Configuring tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks), and "Transit Nodes for Parallel Tasks" in vercel/turborepo's skill reference `tasks.md`.
