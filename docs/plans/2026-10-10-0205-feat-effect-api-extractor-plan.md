---
title: Effect-aware public-API tool - Plan
type: feat
date: 2026-10-10
topic: effect-api-extractor
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Effect-aware public-API tool - Plan

## Goal Capsule

- **Objective:** a maintainer of an Effect-heavy TypeScript library runs one command on a pull request and gets, within seconds, an api-extractor-compatible API report, a versioned JSON API model, and a semver verdict that fails the PR when its changeset under-declares the bump.
- **Means:** a standalone product repository, `systemfsoftware/api-extractor-effect`, built around one versioned API model that a fast syntactic path and a compiler fallback both produce. Upstream `@microsoft/api-extractor` 7.59.1 is the behaviour oracle for the report, never the implementation.
- **Product authority:** the root's round-3 contract (Done 1-9, "does not count", scope). systemfsoftware PR #552 (head `3a135a19cb`) is reference material only. Plan `0530dd7` on `feat/import-api-extractor` is void as a bar; its verified facts are reused below.
- **Open blockers:** P1 (O1's PR making `tsdown-config`, `vitest-config` and `stryker-config` public) and O1's org reusable workflows. Both gate only the toolchain jobs and the lockfile entries that need them (R27).

## Product Contract

### Summary

Build the tool no current project is: fast, with a stable versioned model, and with semver verdicts that understand Effect's `A`/`E`/`R` channels and dual APIs. Keep the one thing #552 did well, a live differential test against upstream api-extractor, and grow it with an adversarial corpus. Everything else is rebuilt around the model, not transliterated from upstream.

### Problem Frame

#552 ports api-extractor faithfully, so it inherits upstream's shape and speed. It has no benchmark, no diff, no verdict, an Apache licence without Microsoft's notice, and it is pinned to the TypeScript 5.9 compiler API, which TypeScript 7 does not provide. The tools that do give verdicts (below) either wrap api-extractor and inherit its speed, or walk the TypeScript 5/6 checker and cannot follow TypeScript 7. None of them knows that adding a tagged error to an `Effect`'s `E` channel breaks a consumer.

### Should this exist / what already solves it

| Tool | What it gives | Why it does not meet the goal | Source |
|---|---|---|---|
| `@microsoft/api-extractor` 7.59.1 | `.api.md` report, `.d.ts` rollup, `.api.json` model (`@microsoft/api-extractor-model`) | No diff, no verdict, no notion of Effect; full type-check per run on the TS 5.x API | `rushstack@bc4cd29:apps/api-extractor/package.json` (`typescript` 5.9.3 bundled) |
| #552 | api-extractor port on Effect 4 with a live differential test | Inherits upstream speed and shape; no model, diff, verdict or benchmark | this doc's premise table |
| `@clerk/break-check` | api-extractor snapshots, diff, bump check, optional LLM review | api-extractor speed; verdicts from rendered text plus an LLM; skips ambient augmentations | github.com/clerk/break-check README |
| `ts-semver-checks` (ardenden) | surface diff, major/minor/patch, `--expect` gate | TypeScript checker API, peer `typescript >=5 <7`, so no TS7; "early MVP" | github.com/ardenden/ts-semver-checks README |
| `semver-checks` (kyungseopk1m) | surface diff and bump on `ts-morph` | `ts-morph` is the TS 5/6 API; no Effect semantics | npmjs.com/package/semver-checks |
| `@api-extractor-tools/change-detector` | diff of two api-extractor rollups | 0.1.0, 6 weekly downloads; inherits api-extractor | npmjs.com/package/@api-extractor-tools/change-detector |
| `tsd` / `expect-type` / `tsc --declaration` diffing | hand-written type assertions; raw `.d.ts` text diffs | Assertions cover only what an author wrote; text diffs have no verdict and churn on formatting | semver-ts.org Appendix B |
| `@arethetypeswrong/cli` | resolution correctness of a packed tarball | Says whether types resolve, not what changed | are-the-types-wrong-effect `nix/attw.nix:87` |
| JSR "fast check" | stable type surface by forbidding inferred export types | Determinism by never inferring; no report or verdict outside JSR | jsr.io/docs/about-slow-types |
| oxc isolated declarations | `.d.ts` emit without the checker, 20-40x tsc | An emitter, not an analyzer; only for isolatedDeclarations-clean code | oxc.rs/blog/2024-09-29-transformer-alpha |
| `cargo-semver-checks` (Rust) | declarative lint queries over a versioned rustdoc model | Rust only; the shape (versioned model plus declarative rules) is the analogy this design borrows | github.com/obi1kenobi/cargo-semver-checks |

Conclusion: the gap is real. Reuse JSR's idea (no inference on the fast path), oxc's emitter only after a profile says so (R16), cargo-semver-checks' declarative-rule shape, and api-extractor as the oracle. Build the model, the Effect-aware rules and the speed.

### Approaches considered

- **A. Refactor #552 in place.** Keeps a working report on day one. It also keeps upstream's analyzer shape, the TS 5.9 API and the speed ceiling, and nothing in it produces a model or verdict.
- **B. Model-first (chosen).** One versioned model is the hub. Both front-ends reduce a package to declaration text and one syntactic builder turns that text into the model; the report renderer and the diff/verdict engine read only the model. Upstream runs beside it as the differential oracle. Costs a rebuild of the report renderer, which the differential test makes safe.
- **C. Wrap upstream.** Run `@microsoft/api-extractor` and diff its `.api.json`. Fastest to a first verdict, but speed is capped at upstream's, the differential test would compare upstream with itself, and Done 7 cannot be met.

B is the only approach where Done 2, 5, 6 and 7 hold together.

### Key Decisions

- **Licence MIT with Microsoft's notice; provenance on every ported file.** (session-settled: user-directed - chosen over #552's Apache-2.0.)
- **#552 is reference, not baseline; its differential test against upstream 7.59.1 is kept.** (session-settled: user-directed - chosen over importing #552 as the starting point.)
- **Shared tooling only through flake inputs, org reusable workflows and the flake template; nothing copied.** (session-settled: user-directed - chosen over vendoring monorepo tsconfig/vitest/oxlint presets, scripts or packs.)
- **Generic toolchain CI jobs (lint, typecheck, build, release, mutation runner, `.sfs-deps` materialisation) come from O1's reusable workflows; until O1 ships one, that job is marked blocked, never replaced locally.** (session-settled: user-directed - chosen over a local equivalent.)
- **Mutation runs on `main` only, with the shared stryker config, proven once by the dispatch workaround (temporary branch trigger, every job `if:`-skipped, `gh workflow run --ref`, removed before the final head).** (session-settled: user-directed - chosen over local or per-PR mutation.)
- **Carried rulings:** drop `stryker-test-contribution` (deleted by its owner, stryker-js-effect `1cf39f2`); `attw` from the are-the-types-wrong-effect flake binary; the stryker `npm:` alias override. (session-settled: user-directed.)
- **Dependency families pre-approved:** official Microsoft packages (`@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `typescript`, `@typescript/native-preview`) once Microsoft is confirmed as publisher, and oxc-project packages (`oxc-transform`, `oxc-parser`) pinned exactly on the family's `0.150.0` line. Any other new executable dependency is an ask. (session-settled: user-directed - chosen over asking per package.)
- **Approach B, model-first.** Both front-ends emit declaration text; one syntactic builder makes the model; renderer and verdict read only the model. Chosen over A and C above.
- **The verdict fails closed.** A change the rule corpus does not classify is reported as major with its own reason code, never dropped.
- **In an output position, removing a tagged error from `E` is major, like adding one.** Effect's `catchTag` constrains its tag argument to `E`'s tags, so a consumer's handler for a removed tag stops compiling. The root named only widening; this extends it on that evidence and is overrulable.

### Requirements

Each requirement names the Done item it serves.

**Repository and provenance** (Done 1)

- R1. The repository is MIT-licensed and carries Microsoft's MIT notice for code derived from `microsoft/rushstack` `apps/api-extractor` at `bc4cd29` (7.59.1).
- R2. Every file derived from upstream or from #552 states its origin (repository, path, commit) in a header; the README states the provenance policy.
- R3. Shared tooling arrives only through flake inputs, org reusable workflows or the flake template; no monorepo tooling or pack is copied.
- R4. `.compound-engineering/config.yaml` declares systemfsoftware's packs as a git source whose `ref` is a systemfsoftware `main` SHA.

**Determinism** (Done 2)

- R5. Every output (model, report, verdict) is byte-identical across process locales (including `tr-TR`), time zones, working directories and hosts.
- R6. A property test generates arbitrary inputs and proves R5 by running the serialiser under several locales and time zones and comparing bytes.
- R7. Every output stamps the engine version, the compiler or emitter that produced its declarations, and the rule-corpus version.

**Report compatibility** (Done 3)

- R8. The tool writes `.api.md` reports that upstream api-extractor 7.59.1 would write for the same package and config, byte for byte.
- R9. A differential test runs upstream and this engine on every PR over a generated (fast-check) corpus and a hand-curated adversarial corpus covering namespace barrels, `declare global`, re-export cycles, overloads and Effect dual APIs. Committed goldens never stand in for running upstream.

**Model, diff and verdict** (Done 4)

- R10. The API model is a versioned JSON document with a `schemaVersion`; a schema change bumps it.
- R11. A diff of two models yields change records; a verdict maps each to a finding `{rule_id, reason_code, next_action, locations}` and the run to `major`, `minor`, `patch` or `none`.
- R12. The rule corpus is declarative data with its own version; the engine only matches changes to rules.
- R13. Effect-aware rules cover the `A`, `E` and `R` channels in input and output positions and dual-API forms; each has a behaviour test that fails on a plausible bug (wrong polarity, wrong channel, missed removal).
- R14. A PR check fails when a changeset declares a smaller bump than the verdict for that package.

**Performance** (Done 5)

- R15. Per-phase timings are profiled on a real corpus (systemfsoftware's public packages) before any native or oxc work is chosen.
- R16. A committed cold and warm benchmark runs in CI on that corpus against upstream api-extractor on the same packages, targeting at least 10x upstream's wall-clock, or reporting the measured ceiling with the phase that stops it.

**Front-ends** (Done 6)

- R17. An isolatedDeclarations-clean package takes a fast path that never type-checks; any other package takes a compiler fallback; both produce the same model for the same package.
- R18. The compiler sits behind an adapter boundary so TypeScript 7's API (expected in 7.1) slots in without a model schema change.

**Idiom** (Done 7)

- R19. The analyzer holds no mutable upstream class internals: data is immutable values and phases are functions over them.

**CLI** (Done 8)

- R20. One command, agent-first: JSON output carrying `schemaVersion` by default, and a concise reporter whose output is bounded in lines regardless of package size.

**Journey and delivery** (Done 9)

- R21. A consumer flake takes this repository's released tarball and produces a report and a verdict for a real package.
- R22. CI is green on the exact PR head; product jobs (differential, adversarial corpus, benchmark, journey, changeset-bump check) live in this repository.
- R23. Mutation runs on `main` only (Key Decisions).

### Acceptance Examples

- AE1. Covers R13. A function's return type changes from `Effect<User, NotFound>` to `Effect<User, NotFound | Timeout>`. The verdict is `major`, reason `E_WIDENED`, located at the function's return type.
- AE2. Covers R13. A function parameter typed `Effect<A, NotFound>` becomes `Effect<A, NotFound | Timeout>`. Consumers may now pass more; the verdict is `minor`.
- AE3. Covers R13. A dual API `map` loses its data-last call signature. The verdict is `major`, reason `DUAL_FORM_REMOVED`.
- AE4. Covers R11. A change the corpus has no rule for yields `major` with reason `UNCLASSIFIED_CHANGE`.
- AE5. Covers R5, R6. The same model serialised under `LC_ALL=tr_TR.UTF-8` and `LC_ALL=C` is the same bytes, including names containing `i` and `I`.
- AE6. Covers R14. A changeset declaring `minor` for a PR whose verdict is `major` fails the check and names the finding.

### Scope Boundaries

- Not in scope: switching systemfsoftware consumers to this tool; `.d.ts` rollups beyond what the report needs; a documenter or `.api.json` emitter for api-documenter.
- Not in scope until a profile shows the phase matters (R15): any Rust/native component, and oxc beyond what R17's fast path needs.
- Excluded (does not count): copied monorepo tooling or packs; goldens in place of the differential run; a benchmark not run in CI; tests that restate configuration or implementation; private-repository references; GitHub secrets or environments; npm registry publishing.

### Load-Bearing Premises

| Premise | Source | Status |
|---|---|---|
| #552's real strength is a live differential test against upstream 7.59.1 | #552 `packages/api-extractor/tests/upstream-parity.differential.test.ts` imports `@microsoft/api-extractor` and runs `Differential.compare` | Confirmed; its corpus is 26 fixed fixtures wrapped in `fc.constant`, not generated |
| #552 is Apache-2.0 with no Microsoft notice | #552 `packages/api-extractor/LICENSE:1-3`, `package.json` `license`; `README.md:94-96` promises a notice the tree does not contain | Confirmed |
| Locale-dependent casing at `src/generators/api-report-generator.ts:64` | #552 line 64 `toLocaleUpperCase()`; inherited from upstream `ApiReportGenerator.ts:66` | Line confirmed. Not reproduced: its inputs are the report variants (`alpha`, `beta`, `public`), and Node 24.21 under `LC_ALL=tr_TR.UTF-8` returned `I` for `'i'.toLocaleUpperCase()` while `'tr-TR'` explicitly gives `İ`. Latent, not observed |
| Locale changes collation | Node 24.21 under `LC_ALL=tr_TR.UTF-8`: `localeCompare` sorts `a b ı I i` vs `a b i I ı` under the default locale | Confirmed (local probe); #552 sorts with `Order.String` (code-unit), so unaffected |
| #552 has no benchmark | `git grep -i 'bench\|performance.now\|hrtime'` over #552's package: 0 hits | Confirmed |
| #552 is an imperative transliteration under an Effect veneer | 296 `Match.when(true, ...)` boolean matches in #552 `src`; module and type names mirror upstream (`Collector`, `AstSymbolTable`, `AstDeclaration`) | Confirmed as shape; it has 0 `let`, 0 loops, 0 `new Map` |
| #552 keeps mutable upstream internals | Every entity is a `Data.TaggedClass`; state threads through 19 `Ref.make/update` and immutable `HashMap.set` | Refuted at the language level; upstream's class graph survives as a `Ref`-held graph |
| #552 is built on the TS 5.9 API | #552 `package.json` `dependencies.typescript: 5.9.3`; 32 imports of `typescript` in `src` | Confirmed |
| "getSortKey reimplemented" | No `getSortKey` in #552. Upstream `Collector.ts:320` sorts by `CollectorEntity.getSortKey()` and `:414` defines `getSortKeyIgnoringUnderscore`; #552 reimplements them as `sortKeyIgnoringUnderscore` / `collectorEntitySortKeyOf` (`collector-entity.ts:79,94`) | Resolved: the claim meant upstream's sort keys |
| TypeScript 7 ships without a programmatic API; 7.1 is expected to add a new one | devblogs.microsoft.com/typescript/announcing-typescript-7-0 ("Running Side-by-Side with TypeScript 6.0"); `typescript@next` is `7.1.0-dev.20261009.1` | Confirmed for 7.0; 7.1 timing unverified |
| TS7 orders types stably by default | same post: `stableTypeOrdering` is `true` and cannot be turned off | Confirmed |
| oxc isolated-declarations emit is 20-40x tsc | oxc.rs/blog/2024-09-29-transformer-alpha: "40x faster than TSC on typical files, 20x faster on larger files" (vendor benchmark) | Confirmed as the vendor's claim |
| JSR gets determinism by never inferring | jsr.io/docs/about-slow-types: `tsc` "does not produce stable type information over time and is too slow" | Confirmed |
| No tool is fast + stable model + semver verdict | Survey above | Confirmed for the tools found; absence beyond them unverified |
| Microsoft publishes the pre-approved packages | `npm view <pkg> maintainers`: `@microsoft/api-extractor`, `@microsoft/api-extractor-model` (microsoft1es, microsoft-oss-releases, odspnpm @microsoft.com; repo microsoft/rushstack); `typescript`, `@typescript/native-preview` (microsoft1es, typescript-bot; repos microsoft/TypeScript, microsoft/typescript-go) | Confirmed 2026-10-10 |
| The family's oxc line is 0.150.0 | systemfsoftware `main` and stryker-js-effect lockfiles resolve `oxc-parser@0.150.0`; `oxc-transform@0.150.0` exists on npm (maintainer boshen, repo oxc-project/oxc) | Confirmed |
| P1 has not landed | systemfsoftware `main` `df908ddf`: `packages/toolchain/{tsdown,vitest,stryker}-config/package.json` `"private": true` | Confirmed 2026-10-10 |
| O1's reusable workflows and flake template do not exist yet | systemfsoftware `main` has `reusable-checks.yml` (needs a repo-local composite action and turbo) and `reusable-smoke.yml`; no flake template output; pnpm-release-management offers `release.yml` and `changeset-check.yml` | Confirmed; lint/typecheck/build/mutation/`.sfs-deps` jobs are blocked on O1 |
| Effect's `catchTag` constrains its tag to `E` | effect 4 `Effect.catchTag` signature | Unverified until the model PR reads the installed `effect` types |

### Outstanding Questions

**Resolve Before Planning:** none.

**Deferred to Planning:**

- The PR split and order, given that toolchain jobs and the lockfile entries for the three private packages wait on O1/P1.
- Which compiler serves the fallback before TS 7.1: the TypeScript 6 API (`typescript@6`) or the TS7 `tsc` binary's declaration emit.
- How the report renderer reproduces upstream's ordering and annotations from the model; which upstream rules port, with provenance.
- The real-corpus selection for R15/R16 and how the benchmark runs upstream on it within CI time.
