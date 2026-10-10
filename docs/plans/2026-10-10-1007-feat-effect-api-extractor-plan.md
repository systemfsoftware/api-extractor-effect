---
title: Effect-aware public-API tool - Plan
type: feat
date: 2026-10-10
topic: effect-api-extractor
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
supersedes: docs/plans/2026-10-10-0846-feat-effect-api-extractor-plan.md
execution: code
---

# Effect-aware public-API tool - Plan

## Goal Capsule

- **Objective:** a maintainer of an Effect-heavy TypeScript library runs one command on a pull request and gets, within seconds, an api-extractor-compatible API report, a versioned JSON API model, and a semver verdict that fails the PR when its changeset under-declares the bump.
- **Means:** a standalone product repository, `systemfsoftware/api-extractor-effect`, built around one versioned API model that a fast syntactic path and a compiler fallback both produce. Upstream `@microsoft/api-extractor` 7.59.1 is the behaviour oracle for the report, never the implementation.
- **Product authority:** the root's round-3 contract (Done 1-9, "does not count", scope). systemfsoftware PR #552 (head `3a135a19cb`) is reference material only. Plan `0530dd7` on `feat/import-api-extractor` is void as a bar; its verified facts are reused below.
- **Open blockers:** P1 landed (systemfsoftware #707, `732f66a0c8`): `tsdown-config`, `vitest-config` and `stryker-config` are public. PR2 is the toolchain slice (U12-U17). It is still blocked on O1 for two things: a reusable mutation workflow and the shared `.sfs-deps` action (KTD20). Neither exists at a pinned SHA, and no local copy is written. R22 is met PR by PR.

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
- **Generic toolchain CI jobs (lint, typecheck, build, release, mutation runner) come from O1's reusable workflows; until O1 ships one, that job is marked blocked, never replaced locally.** (session-settled: user-directed - chosen over a local equivalent.)
- **`.sfs-deps` materialisation evaluates this repository's own flake in CI** (install Nix, `nix build .#sfs-deps`, then `pnpm install --frozen-lockfile`); a shared `.sfs-deps` action is listed in the PR body as an O1 candidate. (session-settled: root ruling 2026-10-10 - reverses the earlier "blocked on O1" for `.sfs-deps`; chosen over copying stryker-js-effect's `released-tarballs` action.)
- **Public family packages are used now: the verdict pipeline is an `effect-cell-types` workflow and cell, codec laws come from `effect-schema-law`, PR4's lane uses `differential-spec`.** (session-settled: root ruling 2026-10-10 - chosen over plain functions rewritten onto cells in a later PR, and over hand-rolled law and differential harnesses.)
- **Mutation runs on `main` only, with the shared stryker config, proven once by the dispatch workaround (temporary branch trigger, every job `if:`-skipped, `gh workflow run --ref`, removed before the final head).** (session-settled: user-directed - chosen over local or per-PR mutation.)
- **Carried rulings:** drop `stryker-test-contribution` (deleted by its owner, stryker-js-effect `1cf39f2`); `attw` from the are-the-types-wrong-effect flake binary; the stryker `npm:` alias override. (session-settled: user-directed.)
- **Dependency families pre-approved:** official Microsoft packages (`@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `typescript`, `@typescript/native-preview`) once Microsoft is confirmed as publisher, and oxc-project packages (`oxc-transform`, `oxc-parser`) pinned exactly on the family's `0.150.0` line. Any other new executable dependency is an ask. (session-settled: user-directed - chosen over asking per package.)
- **Every test runs on `@systemfsoftware/vitest` in PR1. Decision and serialiser behaviour is `it.prop` laws over the production schemas with the constant-impostor gate on; known-answer tables (a row for every corpus reason code) are generator-body example tests through the public surface; the process-level locale test is an e2e `it.prop` in `apps/api-extractor-e2e`.** (session-settled: root ruling 2026-10-10 - chosen over shipping PR1 with raw `vitest` and `fast-check` and migrating in a stacked layer.)
- **PR2 is the toolchain slice, formerly PR6/U11, now that P1 has landed; front-ends, report, benchmark and CLI move to PR3-PR6.** (session-settled: root ruling 2026-10-10 - chosen over waiting for PR2-PR5 to land first.)
- **Turbo is approved, pinned exactly at `2.10.12` through the pnpm catalog, with no remote cache, no `turbo-team` and no secrets.** systemfsoftware's `reusable-checks.yml` runs tests through turbo. (session-settled: root ruling 2026-10-10 - chosen over a turbo-free CI built on bespoke jobs.)
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
- R6. A property test generates arbitrary inputs and proves R5 by running the serialiser under several locales and time zones and comparing bytes; a CI job serialises the same fixed-seed generated sample on x86_64 and arm64 hosted runners and compares the two outputs byte for byte, with no committed golden on either side.
- R7. Every output stamps the engine version, the compiler or emitter that produced its declarations, and the rule-corpus version.

**Report compatibility** (Done 3)

- R8. The tool writes `.api.md` reports that upstream api-extractor 7.59.1 would write for the same package and config, byte for byte.
- R9. A differential test runs upstream and this engine on every PR over a generated (fast-check) corpus and a hand-curated adversarial corpus covering namespace barrels, `declare global`, re-export cycles, overloads and Effect dual APIs. Committed goldens never stand in for running upstream.

**Model, diff and verdict** (Done 4)

- R10. The API model is a versioned JSON document with a `schemaVersion`; a schema change bumps it.
- R11. A diff of two models yields change records; a verdict maps each to a finding `{rule_id, reason_code, bump, next_action, locations}` and the run to `major`, `minor`, `patch` or `none`.
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
| P1 has landed | systemfsoftware #707 merged as `732f66a0c8`; at that commit `packages/toolchain/{tsdown,vitest,stryker}-config/package.json` carry no `private` field (all `0.1.0`), `tsconfig` 2.0.1 is public | Confirmed 2026-10-10 |
| Public family packages are available now | systemfsoftware `ba6664c1` `flake.nix:58` `lib.mkConsumerStore` picks from `workspace-tarballs.members` (41 tarballs, including `effect-cell-types-12.0.0`, `effect-schema-law-5.0.1`, `vitest-2.0.0`, `tsconfig-2.0.1`, `differential-spec-1.0.1`); this repository's `nix build .#checks.x86_64-linux.consumer-store` builds | Confirmed (local build) |
| O1 has reusable lint/typecheck/build and test jobs, but no reusable mutation job or shared `.sfs-deps` action | systemfsoftware `732f66a0c8` `.github/workflows/reusable-checks.yml:1-8` (`workflow_call`; the caller supplies `.github/actions/checks-lane`). `mutation.yml` is `workflow_dispatch` only. `.github/actions/` holds only `checks-lane`, `grant-kvm`, `install-deps` and `setup-node-runtime`. stryker-js-effect `add6faa` `mutation.yml` is not `workflow_call`. Its `kill-matrix.yml` is `workflow_call`, but it is hard-wired to its own projects, its `PUBLISHED_CLI` path and its repo-local `released-tarballs` action | Confirmed; mutation and the `.sfs-deps` action are blocked on O1 (KTD20) |
| A cold `.sfs-deps` build fits a hosted job | systemfsoftware `ba6664c1` `.github/workflows/nix.yml` budgets 60 minutes for `workspace-tarballs` with no binary cache. PR1 measured this repository's cold `sfs-deps` job at 2m53s (run 38027404485, `e566b16`) and 2m31s (`e3156dd`) | Measured for PR1's closure; PR2 adds the stryker tarballs and the toolchain closure, and its PR head re-measures the job against the 10-minute budget |
| A workflow decision is a plain function returning `Result` | `effect-cell-types` 12.0.0 `dist/index.d.ts`: `MadeWorkflow` is `((command) => Result<Decision, Error>) & WorkflowBrand`; `Sandwich.named(...).decide(...).write(handlers)` decodes the command and answers every encoded variant including `CommandRejected` | Confirmed (types and the cell test) |
| Effect's `catchTag` constrains its tag to `E` | effect 4.0.2 `dist/Effect.d.ts` `catchTag`: `<const K extends Tags<E> \| Arr.NonEmptyReadonlyArray<Tags<E>>, ...>` | Confirmed |
| The oracle's compiler and TS7 print inferred types differently, so R8 cannot hold on a TS7 fallback | Upstream 7.59.1 bundles `typescript` 5.9.3 (`rushstack@bc4cd29:apps/api-extractor/package.json`). Local probe, `--declaration --emitDeclarationOnly` on three inferred exports: 5.9.3 prints `Zed \| Alpha` and `"zeta" \| "alpha" \| 42`; 7.0.2 prints `Alpha \| Zed` and `"alpha" \| "zeta" \| 42` and drops the `b?: undefined` member 5.9.3 adds to an object-literal union. 6.0.3 with `--stableTypeOrdering` matches neither (`b?: undefined` before `a`). 5.9.3 has no `stableTypeOrdering` option (0 occurrences in `lib/typescript.js`); 6.0.3 has it | Confirmed on 3 of 3 probes; the rate on real packages is measured in PR3 (KTD9) |
| Turbo is required by the reusable checks shape | `reusable-checks.yml:263` `run: $PNPM exec turbo run test --concurrency=1 --continue --summarize $TEST_FLAGS $FILTERS`; turbo cache secrets are optional (`:115-126`, unset leaves the remote cache off) | Approved (root ruling 2026-10-10) |
| The family is on turbo 2.10 | stryker-js-effect `add6faa` catalog `turbo: ^2` and pnpm-release-management `b9b4a1d` `package.json:17` `"turbo": "^2.10.12"`; both lockfiles resolve `2.10.12` | Confirmed; pinned exactly at `2.10.12` (KTD17) |
| The planner is a flake package | systemfsoftware `732f66a0c8` `flake.nix:92-98` `test-timings` (Deno, `runtimeInputs = [ pkgs.pnpm_12 ]`); it lists packages with `pnpm ls --recursive --depth -1` (`scripts/tools/test-timings.ts:418-430`) and refuses an empty plan (`:458-460`) | Confirmed |
| `packageManager` must equal the flake's pnpm | pnpm-release-management README "Distribution through Nix": `mkPnpmWorkspacePackages` fails evaluation unless `packageManager` pins `pkgs.pnpm_12` exactly; the sandbox refuses a different major.minor. `nix eval` of `pnpm_12.version` at systemfsoftware `732f66a0c8`'s nixpkgs `aa48d347` gives `12.9.0`; this repo pins `pnpm@12.10.1` | Confirmed; PR2 moves to `12.9.0` (KTD16) |
| `lib.mkConsumerStore` serves one producer | systemfsoftware `flake.nix:58-71`: `files.${dir}` is a linkFarm of systemfsoftware members only; pnpm-release-management `nix/lib/pnpm-store.nix:24-29` copies only the given `files` before an offline frozen install | Confirmed; the store check moves to `mkPnpmConsumerStore` over both producers (KTD15) |
| stryker packages come from a release commit | stryker-js-effect `27b1075905` is the target of tags `stryker-js@v18.1.0`, `stryker-js-vitest-runner@v9.0.1` and `stryker-js-typescript-checker@v8.3.1`. stryker-js-effect pins its own `stryker-published` input there (`flake.nix:32-37`). `stryker-js` 18.1.0 depends on `stryker-js-vm-runner` as `workspace:@systemfsoftware/stryker-js-vitest-runner@^`, and `pnpm-workspace.yaml:101` overrides that alias to the tarball | Confirmed |
| `stryker-config`'s peer range excludes the released stryker-js | `732f66a0c8` `packages/toolchain/stryker-config/package.json`: optional peer `@systemfsoftware/stryker-js: ^17.0.0`; the release is 18.1.0 | Confirmed; install must not fail on it. A refusal is reported as a systemfsoftware fix, not worked around |
| attw comes from a released flake | are-the-types-wrong-effect `d43a8020f7` is the target of tag `arethetypeswrong-cli@v4.2.0`; `flake.nix:30-31` exposes `packages.<system>.attw` | Confirmed |
| The release workflows' caller contract | pnpm-release-management `b9b4a1d` `release.yml` builds `.#workspace-tarballs` and runs each tool under `nix develop`. README "CI" names the grants it needs (`contents`, `pull-requests` and `actions` write), says `ci-workflow` must accept `workflow_dispatch`, and says the dev shell must provide pnpm, `sandbox` and `SANDBOX_PNPM_STORE`. `changeset-check.yml` with `devshell: true` runs the caller's `bootstrap` script; README says a lockfile naming `file:.sfs-deps` tarballs needs that mode. Configuration lives in `release.jsonc` | Confirmed |
| Family packages build TS7 declarations with tsdown | systemfsoftware `732f66a0c8` catalog `typescript: ^7`, `tsdown: ^0.23.0`; `packages/effect-cell-types/tsdown.config.ts` spreads `quietBuild` with `dts: true` | Confirmed as configuration; PR2's build lane proves it here |
| Reusable-job wall times on hosted runners | Not measured: the REST API returned HTTP 403 (rate limit) for stryker-js-effect's `changeset-check.yml` runs on 2026-10-10 | Unverified; PR2 measures every job (Verification Contract) |

### Outstanding Questions

**Resolve Before Planning:** none.

**Deferred to Planning:** none; the Planning Contract answers the PR split (KTD1), the fallback compiler (KTD9), the renderer's source of truth (KTD10) and the corpus (KTD11).

**Deferred to the root (PR2):** the first change intent's bump. PR2 declares `@systemfsoftware/api-extractor: none`, so merging opens no release PR. A `minor` would release 0.1.0 to GitHub Releases before the CLI or the report exist.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Six sequential PRs on `main`, each green on its own head.** PR1 is the model, diff and verdict core on `effect-cell-types` cells, plus the repository foundation and the flake that supplies the public family packages. PR2 is toolchain integration (U12-U17). It moved up from PR6 by root ruling on 2026-10-10, after P1 landed. PR3 is front-ends, the syntactic resolver and the phase profile. PR4 is the report renderer, the differential lane on `@systemfsoftware/differential-spec` and the adversarial corpus. PR5 is the CI benchmark. PR6 is the CLI, the changeset-bump check and the consumer-flake journey. Only O1's reusable mutation workflow and shared `.sfs-deps` action still block anything (KTD20). Governs R3, R21, R22, R23.
- KTD2. **Public family packages come from the flake.** `flake.nix` pins systemfsoftware (`flake.lock`); its `sfs-deps` output links the `workspace-tarballs` members this lockfile names, and `checks.consumer-store` fails the build when a recorded integrity does not match the flake's tarball. `pnpm-workspace.yaml` overrides each `@systemfsoftware/*` package to `file:.sfs-deps/<name>-<version>.tgz`; manifests keep semver ranges. PR1 uses `effect-cell-types` (KTD14), `effect-schema-law` (codec laws for every wire schema), `vitest` and `tsconfig` (the package `tsconfig.json` extends `tsc/no-dom/library`). PR2 adds the toolchain configs and a second producer (KTD15, KTD21); PR4's differential lane uses `differential-spec`. Third-party dependencies are those already in #552's `package.json` plus the pre-approved Microsoft and oxc packages and turbo (KTD17). Governs R3, R19, R21.
- KTD3. **The model is an Effect Schema whose `schemaVersion` is the literal `API_MODEL_SCHEMA_VERSION`** (2 since PR1 refused repeated entry-point paths and enum member names). Decoding rejects any other version. Type expressions are a small structural AST (keyword, literal, reference with optional module and arguments, union, intersection, array, tuple, function, object, opaque text), so rules reason about structure, not printed text. Governs R10, R13.
- KTD4. **One canonical serialiser for every output.** Object keys ordered by UTF-16 code unit (`compareCodeUnits`), model arrays ordered at construction by the same comparison, two-space JSON with a trailing newline. No `Intl`, `toLocale*`, `localeCompare`, dates or paths enter output. Code-unit order is the model's and the JSON's order only; the report renderer (KTD10) orders declarations as upstream does. Governs R5, R7.
- KTD5. **Diff carries position polarity.** A function's parameters are `in`, its return `out`; a `const` is `out`; interface members, class members, type-alias bodies and `let` variables are `both`. Effect types decompose into channels from a declarative channel table (`Effect`, `Stream`: `A`/`E`/`R`; `Layer`: `ROut`/`E`/`RIn`); each channel inherits the position. Local type aliases expand before comparison (cycle-guarded), so a widened alias surfaces on the function that uses it. Governs R11, R13.
- KTD6. **Direction is decided on a small lattice:** union membership by canonical key (`never` is the empty union), literal below its keyword, `unknown`/`any` at the top. Anything else is `changed`. Governs R11.
- KTD7. **The rule corpus is versioned JSON data** (`corpusVersion`, the channel table, and rules keyed by change kind plus optional `channel`/`position`/`direction`), decoded through a schema at load. Each rule carries `rule_id`, `bump`, `reason_code`, `next_action`. The engine picks the most specific matching rule; no match yields `major`/`UNCLASSIFIED_CHANGE`. Governs R11, R12.
- KTD8. **Locale determinism is proven across real processes.** Node fixes its default locale at start-up, so no in-process test can vary it. The property test serialises a generated batch in child processes under `LC_ALL`/`TZ`/`cwd` variants, asserts each child really resolved its locale (so the test cannot pass vacuously), and compares bytes. This is one of the 2-4 process-level tests the test-layer gate allows. Governs R6.
- KTD9. **Front-ends meet at declaration text behind an emitter port** (PR3). The compiler fallback runs TypeScript 7's `tsc --declaration --emitDeclarationOnly` as a process, because TS7 has no API until 7.1. The fast path emits isolated declarations without a checker. PR3 commits a per-phase profile (R15) on the corpus of KTD11 before choosing the fast-path emitter: TypeScript's `transpileDeclaration` or `oxc-transform` 0.150.0. R8 is not loosened. The profile records how often TS7 `tsc` prints declarations differently from the oracle's TypeScript 5.9.3 on the KTD11 corpus. Where they diverge, the report-path fallback emits with the oracle's compiler line behind the same port, and TS7 stays an adapter. The 7.1 API becomes another adapter of the same port. Governs R8, R15, R17, R18.
- KTD10. **The report renderer reads only the model** (PR4), so the model keeps what the report needs: declaration text spans with their TSDoc, release tags and analysis messages; adding them bumps `schemaVersion` (R10). The renderer orders declarations with upstream's `getSortKeyIgnoringUnderscore` (lower-case first, `_`-prefixed last), ported with an R2 provenance header. "Keeping #552's differential test" means keeping the live run against upstream 7.59.1; PR4 writes the lane fresh against the rebuilt renderer, using #552's `upstream-parity.differential.test.ts` as a design reference. Governs R8, R9.
- KTD11. **The real corpus is systemfsoftware's public packages, read from a checkout of systemfsoftware `main` at the pinned SHA.** That is a source read, not a dependency, so KTD2 holds. The corpus adds this repository's own package, made isolatedDeclarations-clean in PR3, as the real input the fast path can take. systemfsoftware's packages are not isolatedDeclarations-clean: none enables it, and `packages/discern/src` alone has 133 unannotated exported `const`s. So they measure the fallback. PR3 profiles phases on the corpus (R15); PR5 benchmarks both paths against upstream 7.59.1 on the same packages (R16). Governs R15, R16.
- KTD12. **CI for PR1** builds `.sfs-deps` once from the flake, runs the `consumer-store` check, and hands the tarballs as an artifact to the product job (pnpm, Node 24, property, integration and determinism tests) and to the x86_64 and arm64 host-bytes jobs, which a compare job checks byte for byte. PR1 had no lint, typecheck, build, release or mutation job and wrote no local equivalent; PR2 moves lint, typecheck, build and test onto `reusable-checks.yml` (KTD18) and release onto pnpm-release-management (KTD19), leaving mutation blocked on O1 (KTD20). Governs R6, R22.
- KTD13. **Analysis messages come from a syntactic resolver over the declaration files** (PR3), not the checker. `ae-forgotten-export`, `ae-missing-release-tag` and the other messages the report carries depend on the module graph and TSDoc, which declaration text holds. A message that needs the checker routes the package to the fallback, so R8 holds on both paths. The differential lane (R9) is the arbiter: a mismatch is either a port gap (fix the resolver) or a checker-only message (add it to the fallback routing). Governs R8, R17.
- KTD14. **The verdict is a cell.** `judgeSurfaces` is a `Workflow.make` decision over a `CompareSurfaces` command (two decoded models and a corpus) that returns `Verdict` or `AmbiguousRuleCorpus`; corpus ambiguity is the decision's to judge, so `decodeRuleCorpus` only decodes. `verdictCell` is a `Sandwich.named('api_extractor.verdict')` shell that decodes the command, runs the decision and writes canonical JSON, failing with `SurfaceRejected` (undecodable input) or `RuleCorpusRejected`. The public surface is two namespaces, `ApiModel` and `Verdict`. Schema-backed tagged classes are immutable values, so R19 holds. Governs R11, R12, R19.
- KTD15. **Two producers fill one `.sfs-deps`, under one store check (PR2).** `flake.lock` pins four inputs:
  - systemfsoftware `732f66a0c85819b2005f9e0930a595bc4de91ee1`.
  - stryker-js-effect `27b1075905a6c69e74eff163567ac25dd4839a1b`, the `stryker-js@v18.1.0` release commit, so the tarballs carry the integrities its tags record.
  - are-the-types-wrong-effect `d43a8020f7dc82a32de410823c6da5298c53a3b6` (`arethetypeswrong-cli@v4.2.0`).
  - pnpm-release-management `b9b4a1d48cc16241b33f9afd8ab99b82b05ce04f`, whose `nixpkgs` follows this flake's.

  `sfs-deps` links the systemfsoftware members the lockfile names and the stryker release tarballs. `systemfsoftware.lib.mkConsumerStore` lays only systemfsoftware members into `.sfs-deps`, so its store build would fail on the stryker `file:` entries. `checks.consumer-store` therefore becomes `pnpm-release-management.lib.mkPnpmConsumerStore` with `files.".sfs-deps"` set to `sfs-deps`, which keeps the integrity check over both producers. Overrides stay `file:.sfs-deps/...`. They add the `"@systemfsoftware/stryker-js-vm-runner@npm:@systemfsoftware/stryker-js-vitest-runner@^9.0.1"` alias entry, pointing at the runner tarball. Governs R3.
- KTD16. **pnpm is pinned to the flake's `pnpm_12`.** `packageManager` moves from `pnpm@12.10.1` to `pnpm@12.9.0`, the `pnpm_12` of the followed nixpkgs. `mkPnpmWorkspacePackages` and the sandbox both refuse a mismatch. The lockfile is regenerated with 12.9.0. Governs R3.
- KTD17. **Turbo is a root devDependency, `turbo: 2.10.12` in the catalog** (root ruling 2026-10-10). The root `turbo.json` defines four tasks:
  - `build`: depends on `^build`, outputs `dist/**`.
  - `typecheck`: depends on `^build`.
  - `lint`.
  - `test`: its inputs include `vitest.config.ts`.

  The root scripts `build`, `lint`, `typecheck` and `test` call `turbo run`. The remote cache stays off: `turbo-team` is never set and no `turbo-api`/`turbo-token` secret is passed. Governs R22.
- KTD18. **CI calls `reusable-checks.yml` at `732f66a0c8` and supplies its own `checks-lane` action.** The reusable workflow's contract asks the caller for `.github/actions/checks-lane` (`reusable-checks.yml:3-6`). This repository writes its own adapter. systemfsoftware's action is not copied: it runs that repository's repo checks, rust and gritlint lanes. Phases:
  - `plan` and `timings`: install Nix and put `nix build .#test-timings` (systemfsoftware's package, re-exported) on `PATH`.
  - `lint`, `typecheck`, `build` and `test`: download the `sfs-deps` artifact, run `pnpm/action-setup`, Node 24 and `pnpm install --frozen-lockfile`.
  - `build`: also put `nix build .#attw` on `PATH`; the lane runs the build, then `attw --pack` on the package.

  Inputs:
  - lanes `lint`, `typecheck` and `build · attw`, each at `timeout-minutes: 10`;
  - `timeout-minutes: 10`, `max-seconds: 600`, `plan-timeout-minutes: 10`;
  - no `dry-run`, so every package is planned.

  The caller grants `contents: read` and `actions: read`, the record listing needs both. The `sfs-deps`, `host-bytes` and `host-compare` jobs stay caller jobs (KTD12). The planned test jobs replace PR1's `Product tests` job. `ci.yml` also accepts `workflow_dispatch`, which `release.yml` needs. Governs R6, R22.
- KTD19. **Releases go through thin callers of pnpm-release-management at `b9b4a1d48c`.** Both callers pin a SHA, never `@main`.
  - `release.yml` runs on push to `main` with `ci-workflow: ci.yml`. It grants `actions`, `contents` and `pull-requests` write. It calls `release.yml@b9b4a1d48c`.
  - `changeset-check.yml` runs on pull requests with `devshell: true`, because the lockfile names `file:.sfs-deps` tarballs. It grants `contents: read` and `pull-requests: read`, as pnpm-release-management's own `changeset.yml` caller does.

  Every action a PR2 workflow or the `checks-lane` action calls is pinned by commit SHA with its tag in a trailing comment, as `reusable-checks.yml` pins its own.

  This repository supplies what the workflows require:
  - `release.jsonc`: `base: main`, `branch: changeset-release/main`, `versioning.strategy: changesets`, `gate: { strategy: turbo, task: build }`.
  - `.changeset/` with a README, and `versioning.changelog.storage: repository` in `pnpm-workspace.yaml`.
  - Flake `packages.workspace-tarballs`: `mkPnpmWorkspacePackages` with the same `files`.
  - Flake `packages.pnpm-store`: the KTD15 store.
  - `devShells.default`: `pnpm_12`, `nodejs_24`, `release-tools`, `sandbox` and `SANDBOX_PNPM_STORE`, plus a `shellHook` that copies `sfs-deps` into `.sfs-deps`, since the sandbox cannot read a store path outside its closure.
  - A root `bootstrap` script, `sandbox -- pnpm install`.

  Nothing is published to npm: a release is a git tag, a GitHub Release and the flake output. Governs R3, R14 (the intent half).
- KTD20. **Mutation and the shared `.sfs-deps` action stay blocked on O1; nothing is copied.** No reusable mutation workflow exists at a pinned SHA (premise table). PR2 ships what such a job consumes:
  - the stryker devDependencies from the release tarballs;
  - `stryker.config.ts` on `stryker-config`'s `sharedConfig` and `shardMutate`, with the vitest runner, the typescript checker and both ignorers;
  - a `mutation` script.

  Mutation gets no workflow file and no dispatch proof in PR2, and no stryker runs locally. Once O1 ships the job, the caller runs on push to `main` (plus `workflow_dispatch` for the proof, with publish steps guarded to `main`), never on `pull_request`. The PR body lists both items as blocked on O1. Governs R23.
- KTD21. **Package configs come from the family packages, not from copies.**
  - `tsdown.config.ts` spreads `quietBuild` from `@systemfsoftware/tsdown-config/quiet-build`. It emits `dist/mod.mjs` and `dist/mod.d.ts` with `dts: true`, with dev exports under the `@systemfsoftware/source` condition, as `effect-cell-types` does.
  - `vitest.config.ts`, in the package and in the e2e app, uses `@systemfsoftware/vitest-config`'s `defineConfig` and `sharedConfig`; the package keeps `inlineSchemaTests()`.
  - `oxlint.config.ts` extends `@systemfsoftware/oxlint-config-recommended`.
  - `.attw.json` keeps #552's ignore rules (`no-resolution`, `cjs-resolves-to-esm`), since the package is ESM-only.

  New devDependencies come only from #552's list, the family tarballs, turbo (KTD17), and `@microsoft/api-extractor` 7.59.1, which `tsdown-config` requires as a peer (pre-approved). `oxlint-tsgolint` arrives as `oxlint-config-recommended`'s peer, as it did in #552. `@effect/tsgo` 0.50.0 is a root devDependency whose `prepare` script (`effect-tsgo patch --oxlint`) loads the preset's `effecttsgo` plugin (root ruling 2026-10-10). The e2e app adds `@effect/platform-node` (in #552's dependencies) and `effect-gherkin-spec` (a family tarball). The family's `api:check` (upstream api-extractor on this package) is not added: PR4 owns this repository's own report. Governs R3, R19.

  The preset is conformed to inside PR2, never overridden (root ruling 2026-10-10: no rule `off`, ignore pattern or disable comment; a rule that forbids correct code is reported as a preset defect). Conformance restructures `src` without changing output bytes: decision code moves into `*.schema.ts` modules beside its types (`make-body-purity`), every `src` function holds one decision (`complexity` max 2), and casts give way to schema guards and `Match`. Tests follow the preset's lanes: workflow laws in `src/__tests__/*.workflow.property.test.ts`, behaviour in `tests/*.integration.test.ts` features on `effect-gherkin-spec` through the published package, and the e2e locale proof as a feature that spawns the probe.

### Assumptions challenged (destructive review, Edge-First lens)

1. *Both front-ends yield the same model.* Compiler emit prints inferred types and `import("x").Y` references that isolated emit never produces. PR3 canonicalises import-type references in the builder and proves fast-path and fallback models equal on the isolated-clean corpus (R17).
2. *The report can be rendered from a model.* Upstream copies declaration text verbatim and adds messages from analysis. KTD10 keeps spans and messages in the model; the differential lane (R9) arbitrates.
3. *A syntax-only verdict is sound.* A changed local alias changes `E` without changing the function's text. KTD5 expands local aliases; changes inside dependencies are out of scope, and anything unclassified fails closed (KTD7).

### Assumptions challenged (destructive review, Substitution lens)

Rotated from Edge-First because the plan's primary pattern was substituted: plain functions became a workflow and a cell, and a no-dependency PR1 became a flake consumer.

1. *Building `.sfs-deps` from the flake is cheap enough for every PR.* systemfsoftware's own job budgets 60 minutes for the same derivation with no binary cache. KTD12 builds it once per run and hands the tarballs to every other job as an artifact; PR1's first run records the cold time, and a cache belongs in the shared `.sfs-deps` action proposed to O1, not in a local equivalent.
2. *Moving the ambiguity check from decode time to the decision changes nothing.* A corpus with two rules sharing a match used to throw on load; now it is a typed `AmbiguousRuleCorpus` from the decision. The shipped corpus is still guarded: every decision property runs on `defaultCorpus` and fails if that corpus is refused.
3. *Tests can stay where #552 put them.* The test-layer gate requires codec laws next to each schema and decision properties next to the workflow, and admits the shell only as an in-process integration test with deterministic inputs. U2 and U4 now name those files.

Radical alternative considered: take the tarballs from systemfsoftware's CI artifacts or GitHub Releases instead of building them. Rejected: neither is a pinned, reproducible input today, and `lib.mkConsumerStore` already checks the lockfile's integrities against the flake's own build.

### Assumptions challenged (destructive review, Inversion lens)

Rotated from Substitution because the step order was the assumption: PR1 wrote its tests in raw `vitest` and `fast-check` and would adopt the family idiom later.

1. *The test idiom can follow the code.* Inverted, the idiom decides which tests survive. Under the law-only rule and the constant-impostor gate, the per-channel loop and the change-kind table were known-answer tables whose oracle restates the corpus; they are example rows now, and every corpus reason code has one.
2. *Hand-mirrored arbitraries describe the model.* Inverted, the production schema is the arbitrary. Drawing from it produced models that repeat an enum member name or an entry-point path; the diff of such a model against itself was not empty. The schema refuses them, with a generation hint so drawing stays constructive.
3. *A process-spawning test is a slow property test.* Inverted, it is an e2e journey: it moves out of the package to `apps/api-extractor-e2e`, drives only the public surface, and still pins the locale, time zone and working directory each child resolved.

Radical alternative considered: keep laws only and drop the known-answer rows. Rejected: a law covering each rule would need an oracle that copies the corpus.

### Assumptions challenged (destructive review, Scope Challenge lens)

Rotated from Inversion because PR2's objective joins independent work: flake inputs, the CI shape, the release callers and mutation.

1. *PR2 is one concern.* Split by artifact, U12-U14 (inputs, configs, flake outputs) are one layer every other unit needs. U15 (CI) and U16 (release) each depend only on that layer. U17 is not work. The root's predicate names one PR, so the units stay together. They are ordered so that U16's callers do nothing until a push to `main`, and so that dropping U16 would leave U12-U15 green.
2. *Mutation inputs belong with mutation.* Without a runner, `stryker.config.ts` and the stryker devDependencies are inputs nobody calls yet. They ship because the root kept the stryker input and the `npm:` alias entry. The typecheck lane compiles the config, so it cannot rot unseen.
3. *The 10-minute budget is a property of this repository's workflows.* Two jobs live in pnpm-release-management's reusable workflows, which set no `timeout-minutes` this caller can change: the changeset check and release. The budget is proven there by measurement only. A breach is reported against the reusable workflow, not fixed locally.

Radical alternative considered: skip reusable-checks and run lint, typecheck, build and test as caller jobs, like PR1's `Product tests`. Rejected: those are generic jobs, which the session-settled rule sends to the shared reusable workflow whenever one exists.

PR2 adds no new behaviour tests. Each unit is configuration, proven by builds and the CI run; the lint conformance moves the existing tests into the preset's lanes and keeps what each proves.

---

## Implementation Units

PR1 and PR2 units are implementation-ready; PR3-PR6 are scoped here and refined at the start of each PR (KTD1).

### U1. Repository foundation (PR1)

- **Goal:** the repository is a licensed, provenance-stating product home with pinned packs.
- **Requirements:** R1, R2, R3, R4.
- **Files:** `LICENSE`, `README.md`, `AGENTS.md`, `.compound-engineering/config.yaml`, `flake.nix`, `flake.lock`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `packages/api-extractor/{package.json,tsconfig.json,vitest.config.ts}`.
- **Approach:** `LICENSE` is MIT ("Copyright (c) 2026 System F Software") followed by Microsoft's MIT notice for `rushstack@bc4cd29` `apps/api-extractor`. README states the provenance policy (R2), the PR roadmap and how `.sfs-deps` is built. Packs: one git source `https://github.com/systemfsoftware/systemfsoftware.git`, `ref` = systemfsoftware `main` `df908ddfe497e53c1c03b92519a96c913c441a58`, `path: compound-packs`, packs `cell-architecture`, `boundary-testing`, `schema-laws`, `package-topology`. `packageManager` pins pnpm 12.10.1. The flake and the overrides follow KTD2; `.sfs-deps/` is gitignored. The package `tsconfig.json` extends `@systemfsoftware/tsconfig/tsc/no-dom/library`.
- **Test expectation:** none - configuration and documents.
- **Verification:** the CE pack resolver returns four roots with no errors; `git grep -n '/tree/main' -- .compound-engineering` prints nothing; `nix build .#checks.x86_64-linux.consumer-store` builds; from an empty `.sfs-deps`, `nix build .#sfs-deps` then `pnpm install --frozen-lockfile` succeeds.

### U2. Versioned API model and canonical serialiser (PR1)

- **Goal:** a decodable, versioned model and one byte-stable serialiser.
- **Requirements:** R5, R7, R10; KTD3, KTD4.
- **Files:** `packages/api-extractor/src/model/*.ts` (including `serialise.ts` and the colocated `serialise.property.test.ts`; `effect-schema-vite` writes codec and recursion laws for every exported schema into `src/schema-laws.test.ts`), `src/canonical-json.ts`, `src/version.ts`, `src/ApiModel.ts`.
- **Approach:** Effect Schema for `ApiModel` (`schemaVersion`, `producer {engine, declarations}`, `package`, `entryPoints[].items[]`, `entryPoints[].locals[]`) and the type AST. `sortModel` orders entry points, exports and locals by code unit. The schema is sized for the verdict; PR3 first validates it against real declaration text and PR4's renderer fields (KTD10) bump `schemaVersion`.
- **Test scenarios:** (generated schema laws) codec round trip and encode stability for every exported schema, recursion laws for the declared budgets; (`it.prop` over `ApiModel`) its canonical bytes decode back to the sorted model and re-serialise to the same bytes; exports, and a value and a type sharing a name, in any order serialise to the same bytes; (U4 integration) the cell refuses a document of another `schemaVersion`. The schema refuses a model that repeats an enum member name or an entry-point path, since no TypeScript surface declares one (`schemaVersion` 2).
- **Verification:** the property suite passes; no `toLocale`, `localeCompare` or `Intl` in `src`. R7's stamps are required fields of both schemas, so a model or verdict without them does not decode or typecheck.

### U3. Diff with polarity and Effect channels (PR1)

- **Goal:** two models produce position-aware change records.
- **Requirements:** R11, R13; KTD5, KTD6.
- **Files:** `src/diff/*.ts`.
- **Approach:** compare entry points, exports, overloads (matched by exact form, then dual form, then index), parameters, members, enum members and types; decompose Effect references by the channel table; expand local aliases.
- **Test scenarios:** (property, through the verdict - U4) diff of a model with itself is empty.
- **Verification:** U4's suite.

### U4. Declarative rule corpus and verdict (PR1)

- **Goal:** change records become findings and a verdict.
- **Requirements:** R11, R12, R13; KTD7.
- **Files:** `src/rules/corpus.v1.json`, `src/rules/corpus.ts`, `src/verdict.schema.ts`, `src/findings.ts`, `src/judge-surfaces.workflow.ts`, `src/judge-surfaces.workflow.property.test.ts`, `src/verdict.cell.ts`, `src/Verdict.ts`, `src/mod.ts`, `tests/verdict.integration.test.ts`, `tests/change-kinds.integration.test.ts`, `tests/rule-corpus.integration.test.ts`.
- **Approach:** KTD14. Decode the corpus; the decision refuses an ambiguous corpus, then for each change picks the most specific rule, groups changes by rule into `{rule_id, reason_code, bump, next_action, locations}` (locations distinct, code-unit order), and takes the highest bump; it stamps engine and corpus versions. The cell writes the encoded verdict through `canonicalJson`.
- **Test scenarios (`it.prop` laws over surrounding models drawn from the production `ApiModel` schema; one known-answer example row per corpus reason code, Effect channel moves included; the corpus classifies every change kind and has no dead rule):** AE1 (`E` widened in output, major `E_WIDENED`); `E` member removed in output (major `E_TAG_REMOVED`); AE2 (`E` widened in input, minor); `A` and `R` widened/narrowed in both positions; the same change through a local alias; AE3 (dual form removed, major `DUAL_FORM_REMOVED`); export removed (major) and added (minor); required parameter added (major), optional added (minor); AE4 (a corpus without the matching rule yields `UNCLASSIFIED_CHANGE`); the verdict equals the highest finding bump and adding an unrelated change never lowers it; one rule firing at several exports is one finding listing each location once in code-unit order; a corpus with two rules sharing a match is refused naming that match. (schema law, colocated) `ruleOfSchemas` for `RuleCorpus` and `Verdict`. (integration, deterministic inputs) the cell answers canonical JSON for AE1, fails an undecodable surface with `SurfaceRejected`, and fails an ambiguous corpus with `RuleCorpusRejected`.
- **Verification:** the property suite passes. Its sensitivity was shown on the way in: the local-alias property failed against the first diff (it compared structural keys before expanding aliases) and passes on the fixed one. On the cell move, three hand-applied faults were each caught: a constant `none` bump (20 properties failed), first-location-only findings (the locations property failed), and a swapped refusal in the cell (the integration test failed).

### U5. Locale and host determinism proof (PR1)

- **Goal:** R5 holds across real process environments.
- **Requirements:** R5, R6; KTD8.
- **Files:** `apps/api-extractor-e2e/locale-determinism.e2e.test.ts`, `apps/api-extractor-e2e/probe.ts`, `apps/api-extractor-e2e/outputs.ts`, `apps/api-extractor-e2e/host-digest.ts`. The test spawns processes, so it lives in the e2e cell outside the package and drives only the public surface.
- **Approach:** an `it.prop` draws models from the production `ApiModel` schema, whose string arbitrary reaches `i I ı İ ß` and mixed scripts; children under `C`/`UTC`, `tr_TR.UTF-8`/`Europe/Istanbul`, `de_DE.UTF-8`/`America/Los_Angeles` and a different `cwd` serialise models and verdicts, and each must write the bytes the test process writes. `host-digest.ts` serialises a fixed-seed sample from the same schema and the verdicts between them through the cell, for KTD12's cross-host comparison.
- **Test scenarios:** AE5; each child reports the locale it resolved, and the test fails if `tr-TR` was not actually in effect.
- **Verification:** the test passes and its assertions show each child resolved `tr`/`de` and its own time zone and working directory.

### U6. PR1 CI (PR1)

- **Goal:** the PR head proves U2-U5 on GitHub-hosted Linux.
- **Requirements:** R6, R22; KTD12.
- **Files:** `.github/workflows/ci.yml`.
- **Approach:** KTD12. `sfs-deps` job: checkout, `cachix/install-nix-action@v31`, copy `nix build .#sfs-deps` into `.sfs-deps`, build `checks.x86_64-linux.consumer-store`, upload the tarballs. `test` and `host-bytes` (x86_64 `ubuntu-latest`, arm64 `ubuntu-24.04-arm`) download them, then `pnpm/action-setup` (reads `packageManager`), Node 24, `pnpm install --frozen-lockfile`; `host-compare` runs `cmp` on the two outputs. `permissions: contents: read`; no secrets.
- **Verification:** the run on the PR head is green.

### U7-U11. Later PRs (scoped)

- **U7 (PR3) Front-ends:**
  - a syntactic model builder over declaration text;
  - a syntactic resolver for analysis messages (KTD13);
  - the isolated fast path, the TS7 `tsc` fallback and the emitter port;
  - fast-vs-fallback model equality on an isolated-clean corpus, with this package made isolatedDeclarations-clean;
  - a per-phase profile on the KTD11 corpus, committed before the emitter is chosen.

  R15, R17, R18; KTD9, KTD11, KTD13.
- **U8 (PR4) Report:** `.api.md` renderer from the model, ordered by upstream's sort key; differential lane against upstream 7.59.1 on a fast-check-generated corpus plus the adversarial corpus (namespace barrels, `declare global`, re-export cycles, overloads, Effect dual APIs). R8, R9; KTD10, KTD13.
- **U9 (PR5) Performance:** cold/warm benchmark in CI against upstream on the KTD11 corpus, fast path on the isolated-clean input and fallback on systemfsoftware's packages; 10x target or the measured ceiling with the phase that stops it. R16; KTD11.
- **U10 (PR6) CLI, bump check and journey:** one command, JSON with `schemaVersion`, bounded concise reporter; a PR job fails when a changeset under-declares; the consumer-flake journey (Done 9). The journey needs a report (U8), a verdict and a command (U10), and a released tarball (U16), so PR2 cannot carry it. R14, R20, R21.
- **U11 (PR2) Toolchain integration:** split into U12-U17 below, now that P1 has landed.

### U12. Flake inputs, `.sfs-deps` and the store check (PR2)

- **Goal:** the three toolchain configs, the lint preset closure and the stryker release install from `.sfs-deps`, built by this repository's flake.
- **Requirements:** R3; KTD15, KTD16.
- **Files:** `flake.nix`, `flake.lock`, `package.json` (`packageManager`), `pnpm-workspace.yaml` (catalog, overrides, alias entry), `pnpm-lock.yaml`, `packages/api-extractor/package.json`, `apps/api-extractor-e2e/package.json`.
- **Approach:** pin the four inputs, extend `sfsPackages`, and add the stryker release tarballs to `sfs-deps`. Do not make systemfsoftware's `pnpm-release-management` follow this flake's: a different builder could change the bytes its tarballs pack. The systemfsoftware package list must equal the lockfile's resolved `@systemfsoftware/*` closure (`oxlint-config-recommended` brings its plugins and presets); an omission fails the store check, so the lockfile is the source of the list. Regenerate the lockfile under pnpm 12.9.0.
- **Test expectation:** none - inputs and installation, proven by the builds below.
- **Verification:** `nix build .#checks.x86_64-linux.consumer-store` builds. From an empty `.sfs-deps` and `node_modules`, `nix build .#sfs-deps` then `pnpm install --frozen-lockfile` succeeds. `nix flake metadata` shows the four pinned revisions. `git grep -n 'tree/main\|@main' -- .github flake.nix` prints nothing.

### U13. Turbo and package toolchain configs (PR2)

- **Goal:** build, lint, typecheck and test run through turbo on the family configs.
- **Requirements:** R3, R19; KTD17, KTD21.
- **Files:** `turbo.json`, root `package.json` (scripts, `turbo` and `@effect/tsgo` devDependencies), `pnpm-workspace.yaml` (`turbo: 2.10.12`), `packages/api-extractor/{package.json,tsdown.config.ts,tsconfig.build.json,oxlint.config.ts,vitest.config.ts,stryker.config.ts,.attw.json}`, `apps/api-extractor-e2e/{package.json,vitest.config.ts,oxlint.config.ts,tsconfig.json}`, and the lint conformance of `src`, `tests` and the e2e app (KTD21).
- **Execution note:** lint fixes are refactors, in separate commits by group (structural, complexity, test discipline, e2e). `apps/api-extractor-e2e/host-digest.ts` must still print sha256 `e4478f035b5334cb722f2d4848046e027c33a2b7a74083dc0108bdedf1ee6da2`.
- **Approach:** KTD21. Vitest resolves the package's source through the `@systemfsoftware/source` condition (`vitest-config`'s `sourceResolveConditions`), so tests need no build. Two entry points run under plain Node, whose default conditions would resolve `dist/mod.mjs`: the locale feature's spawned `probe.ts` and CI's `node host-digest.ts`. Both pass `--conditions=@systemfsoftware/source`, so neither needs a build. Typecheck depends on `^build` only if the base tsconfig sets no matching `customConditions`.
- **Test expectation:** no new behaviour. The existing package tests and the e2e locale proof move into the preset's lanes, and each keeps what it proves; the decode/encode round-trip law is left to the generated schema-laws suite.
- **Verification:** `pnpm build`, `pnpm lint` (0 diagnostics), `pnpm typecheck` and `pnpm test` pass locally. `nix run .#attw -- --pack packages/api-extractor` passes. The host digest is unchanged. No stryker command runs.

### U14. Flake outputs for release and CI tools (PR2)

- **Goal:** the flake provides what the release workflows and the checks-lane action call.
- **Requirements:** R3, R21 (the tarball half); KTD18, KTD19.
- **Files:** `flake.nix`, `.gitignore` (`.cache/`, `.turbo/`, `.release/`).
- **Approach:** `packages.workspace-tarballs` and the per-member tarball come from `mkPnpmWorkspacePackages` (`files.".sfs-deps"` as KTD15; `build` script). The flake also exposes `packages.pnpm-store` (the KTD15 store), `packages.test-timings` and `packages.attw`, both re-exported from the inputs, and `devShells.default` per KTD19.
- **Test expectation:** none - build outputs, proven below.
- **Verification:** `nix build .#workspace-tarballs` builds, and `nix build --rebuild .#workspace-tarballs` reproduces it byte for byte. The README warns that an inferred union in emitted declarations breaks this under TS7, and a failure is fixed by annotating the export. `nix develop --command pnpm run bootstrap` installs from an empty `node_modules`. `nix build .#test-timings .#attw` builds.

### U15. CI on reusable-checks (PR2)

- **Goal:** lint, typecheck, build with attw, and planned test jobs run on the shared reusable workflow, and every job on the PR finishes within 10 minutes.
- **Requirements:** R6, R22; KTD12, KTD18.
- **Files:** `.github/workflows/ci.yml`, `.github/actions/checks-lane/action.yml`.
- **Approach:** the `checks` job `needs: sfs-deps` and calls `systemfsoftware/systemfsoftware/.github/workflows/reusable-checks.yml@732f66a0c85819b2005f9e0930a595bc4de91ee1` with the KTD18 inputs. The host-bytes step runs `node --conditions=@systemfsoftware/source` (U13); the compare job is unchanged. No secret is referenced.
- **Test expectation:** none - workflow wiring, proven by the run.
- **Verification:** CI on the PR head is green. The plan job plans both test packages (`@systemfsoftware/api-extractor`, `api-extractor-e2e`). Each job's wall time (`completed_at - started_at`) is at most 10 minutes; the PR body tabulates them.

### U16. Release callers and change intents (PR2)

- **Goal:** changesets and GitHub Releases through pnpm-release-management, with no npm publish.
- **Requirements:** R3, R21 (the release half); KTD19.
- **Files:** `.github/workflows/release.yml`, `.github/workflows/changeset-check.yml`, `release.jsonc`, `.changeset/README.md`, `.changeset/<intent>.md`, `pnpm-workspace.yaml` (`versioning.changelog.storage: repository`), root `package.json` (`bootstrap`).
- **Approach:** KTD19. PR2's intent declares `@systemfsoftware/api-extractor: none` (Outstanding Questions).
- **Test expectation:** none - workflow wiring and data.
- **Verification:** the changeset check is green on the PR head, and its job time is in the U15 table. `release.yml` runs only on push to `main`, so the PR body says its first run is observed after merge. `nix develop --command version-management --help` and `github-release-management --help` resolve from the dev shell.

### U17. Mutation caller (PR2, blocked on O1)

- **Goal:** mutation runs on `main` through O1's reusable job with the shared stryker config.
- **Requirements:** R23; KTD20.
- **Files:** none in PR2 beyond U13's `stryker.config.ts` and `mutation` script.
- **Approach:** blocked until O1 publishes a reusable mutation workflow; the thin `main`-only caller and the `workflow_dispatch` proof (publish steps guarded to `main`) land then.
- **Test expectation:** none - blocked.
- **Verification:** the PR body lists the job and the shared `.sfs-deps` action as blocked on O1.

---

## Verification Contract

| Gate | Command or evidence | Proves |
|---|---|---|
| Flake | `nix build .#checks.x86_64-linux.consumer-store` and `nix build .#sfs-deps`, in CI | R3, KTD2 |
| Product tests | `pnpm test` (Node 24) on the PR head, in CI, installed from the flake's `.sfs-deps` | R5, R6, R7, R10-R13 |
| Host bytes | `host-compare`: `cmp` of the x86_64 and arm64 `apps/api-extractor-e2e/host-digest.ts` outputs, in CI | R5, R6 |
| Typecheck (local until O1) | `pnpm typecheck` | R7, R10 (schema and stamp types) |
| Immutable core | review of the diff: no `let`, no mutation of shared values in `src`; the only classes are Effect Schema tagged classes and errors (immutable values the cell contract requires) | R19 |
| Packs | CE pack resolver: 4 roots, 0 errors | R4 |
| No locale APIs | `git grep -nE 'toLocale|localeCompare|Intl\\.' -- packages/api-extractor/src` prints nothing | R5 |
| Store (PR2) | `nix build .#checks.x86_64-linux.consumer-store` over systemfsoftware and stryker tarballs, in CI | R3, KTD15 |
| Toolchain lanes (PR2) | reusable-checks lanes `lint`, `typecheck`, `build · attw` and planned test jobs, green on the PR head | R3, R22, KTD18 |
| Job budget (PR2) | every job's `completed_at - started_at` on the PR head is at most 10 minutes, tabulated in the PR body | KTD18 |
| Release tarballs (PR2) | `nix build .#workspace-tarballs` and `nix build --rebuild .#workspace-tarballs` | R21, KTD19 |
| Changeset check (PR2) | pnpm-release-management `changeset-check.yml` (`devshell: true`) green on the PR head | R14, KTD19 |
| No remote cache (PR2) | `git grep -nE 'turbo-team|turbo-token|turbo-api|secrets\.' -- .github` prints nothing | KTD17 |

## Definition of Done (PR1)

- U1-U6 verified on the PR head; CI green on that exact SHA.
- The PR body lists every blocked generic job with its O1/P1 blocker, and every review finding with its disposition.
- Every `@systemfsoftware/*` dependency installs from `.sfs-deps` built by this repository's flake at the pinned systemfsoftware commit; no copied toolchain file, no secrets.
- The PR body lists the shared `.sfs-deps` action as an O1 candidate and the cold `sfs-deps` job time.

## Definition of Done (PR2)

- A branch cut from `origin/main` `623b686`; U12-U16 are verified on the PR head; CI is green on that exact SHA.
- `flake.lock` pins systemfsoftware `732f66a0c8`. `tsdown-config`, `vitest-config` and `stryker-config` install from `.sfs-deps` through the overrides. No toolchain file, workflow or action is copied, and the `checks-lane` adapter is this repository's own (KTD18).
- Turbo is pinned at `2.10.12`, with no remote cache and no secrets.
- Every job on the PR finished in 10 minutes or less, with each wall time in the PR body.
- The PR body lists the reusable mutation workflow and the shared `.sfs-deps` action as blocked on O1 (KTD20). It also states that the consumer-flake journey is PR6's (U10).

## Document Review Dispositions

Round 1: report-only `ce-doc-review` (coherence, feasibility, scope-guardian), dispositioned by the author. "Applied" edits are in the plan above. Its PR numbers follow the numbering before the 2026-10-10 reorder (PR2 front-ends through PR6 toolchain).

| # | Finding (reviewer, severity) | Disposition |
|---|---|---|
| 1 | R15 profile lands after the emitter choice it gates (coherence P1; scope-guardian P2) | Applied: profile and corpus move into PR2 (KTD9, KTD11, U7); U9 is the CI benchmark only. |
| 2 | Goal Capsule lists R22 as blocked, contradicting PR1 CI (coherence P2) | Applied: Open blockers names only PR6's work. |
| 3 | Verification omits R7 and R19 (coherence P2) | Applied in part: R7 and R19 added to the Verification Contract. Rejected the suggested stamp-presence test: the stamps are required schema fields, so the test would restate the schema. |
| 4 | U1 omits the lockfile `--frozen-lockfile` needs (coherence P2; feasibility P1) | Applied: `pnpm-lock.yaml` in U1's files, committed in PR1. |
| 5 | "#552's differential test is kept" vs a rebuilt renderer (coherence P3) | Applied: KTD10 says the live upstream run is kept and the lane is written fresh. |
| 6 | PR6 cell adoption has no owning unit (coherence P3) | Superseded by the root ruling of 2026-10-10: PR1 builds the verdict pipeline on cells (KTD14), so no later unit owns the move. |
| 7 | No checker-free source for analyzer warnings in the report (feasibility P1) | Applied: KTD13, a syntactic resolver over declaration files with fallback routing for checker-only messages. |
| 8 | Code-unit model order conflicts with upstream's report order (feasibility P2) | Applied: KTD4 scopes code-unit order to the model and JSON; KTD10 ports upstream's sort key for the report. |
| 9 | Benchmark corpus has no isolatedDeclarations-clean package (feasibility P2) | Applied: KTD11 adds this repository's own package, made clean in PR2, as the fast path's real input. Rejected vendoring a package for it. |
| 10 | Model schema fixed before its producers exist (scope-guardian P3) | Applied: U2 states PR2 validates it and PR3 bumps `schemaVersion`. |

Residual risks the reviewers raised and the plan accepts: R16's measured-ceiling branch can close Done 5 without 10x (the root wrote that branch; the benchmark reports the number either way); mutation (U17) cannot finish until O1 ships a reusable mutation workflow; a slim-ICU Node would weaken KTD8's locale assertion, which the test's resolved-locale check would then fail loudly rather than pass silently.

Round 2: report-only `ce-doc-review` of the PR2 update (coherence, feasibility, scope-guardian, security-lens), dispositioned by the author. The cross-model pass did not run: no `codex`, `grok`, `cursor-agent`, `claude` or `opencode` CLI is installed.

| # | Finding (reviewer, severity) | Disposition |
|---|---|---|
| 11 | The 10-minute job budget conflicts with a cold `.sfs-deps` build budgeted at 60 minutes elsewhere (coherence P1, feasibility P1, scope-guardian P2) | Applied as evidence: the premise row now records PR1's measured cold job, 2m53s and 2m31s, so the budget can be met. Rejected narrowing the budget to the jobs this repository controls: the root's predicate is every job on the PR. A breach in a reusable workflow is reported against it (Scope Challenge 3), and Done is not claimed. |
| 12 | Plain-Node entry points resolve `dist/` once the package exports move to tsdown (feasibility P1) | Applied: U13 and U15 pass `--conditions=@systemfsoftware/source` to the spawned probe and to `node host-digest.ts`. A Node 24.21.0 probe resolved the source export with the flag and failed with `ERR_MODULE_NOT_FOUND` without it. |
| 13 | KTD12 says PR1's missing jobs were blocked on O1, which ships reusable lint, typecheck and build (coherence P2) | Applied: KTD12 names where PR2 moves each job; only mutation stays blocked on O1. |
| 14 | R11's finding shape omits `bump` (coherence P3) | Applied: `verdict.schema.ts` carries `bump` on each finding. |
| 15 | U2's `schemaVersion` 2 contradicts KTD3's literal 1 (coherence P3) | Applied to KTD3, which was stale: `API_MODEL_SCHEMA_VERSION` is 2 (`src/model/api-model.ts:5`). |
| 16 | Third-party actions are pinned by tag (security-lens P3, FYI) | Applied in part: KTD19 pins every action a PR2 workflow calls by SHA. Rejected the proposed grep gate: a new gate needs operator approval (GATE1). |
| 17 | The `changeset-check.yml` caller states no token permissions (security-lens P3, FYI) | Applied: KTD19 grants `contents: read` and `pull-requests: read`. |
| 18 | No PR names the first non-`none` bump that cuts the release PR6's journey needs (scope-guardian, deferred question) | Already open: "Deferred to the root (PR2)" holds the first intent's bump. |

Residual risk added in round 2: U14's `--rebuild` reproducibility check may need some exports annotated in PR2, before KTD11's isolatedDeclarations work in PR3. U14 already says how to fix such a failure: annotate the export.
