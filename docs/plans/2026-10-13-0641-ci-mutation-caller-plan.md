---
title: Mutation Caller - Plan
type: ci
date: 2026-10-13
topic: mutation-caller
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-12-1832-ci-mutation-caller-plan.md
---

# Mutation Caller - Plan

## Goal Capsule

- **Objective:** mutation testing grades `@systemfsoftware/api-extractor`'s verdict-decision code once a night on `main` and on manual dispatch on `main`, and a surviving mutant turns that run red. The decision code is `src/**/*.workflow.ts` and the `src/**/*.schema.ts` files beside the types it operates on (`AGENTS.md:12`).
- **Means:** a thin caller, `.github/workflows/mutation.yml`, of systemfsoftware's shared `reusable-mutation.yml`, pinned by full SHA.
- **Scope:** CI and dev toolchain only, until the re-pin (U5). The package tarball stays byte-identical to the one the `@systemfsoftware/api-extractor@v0.0.0` tag records, and the PR's release intent is `none` (KTD8).
- **Authority:** systemfsoftware `CONSTITUTION.md` and the Compound Packs this repository enrolls bind first; a conflict between them and a root ruling is recorded with both citations and the ruling decides. Then this plan, then `AGENTS.md`, then `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md` (KTD20).
- **Supersedes** `docs/plans/2026-10-12-1832-ci-mutation-caller-plan.md`, which stays as the contract its executed units (U1-U4) were verified against. Changed: the cadence (R1, KTD3, KTD5, KTD10), the proof run (R4, U6), the re-pin's package scope (R3, KTD8, KTD11). Carried unchanged: R2, R5, R6 and KTD1, KTD2, KTD4, KTD6, KTD7, KTD9.
- **Execution profile:** the mutation-caller PR on `feat/mutation`, a draft until the Definition of Done holds. The agent commits and pushes; the operator merges.
- **Stop conditions:**
  - A unit other than U5 needs a path under `packages/` or `apps/`: stop; that work is a separate layer on `main` (R3).
  - The pin for the proof run does not satisfy R5: no merge.
  - A proof-run job exceeds 600 s, or the summary grades below the break threshold: stop and report; R4 holds the merge.

---

## Product Contract

### Requirements

- R1. At this PR's final head the caller has exactly two triggers, a nightly `schedule` and `workflow_dispatch`, and runs only on `refs/heads/main`. It has no `push`, `pull_request` or `merge_group` trigger.
- R2. The caller is a thin `workflow_call` of `reusable-mutation.yml` pinned by commit SHA, with only that workflow's inputs and the permissions its jobs ask for.
- R3. Before U5, this PR's own commits change no path under `packages/` or `apps/` and add no `.changeset/` intent. At U5 the only `packages/api-extractor` change is the removal KTD11 names, with a `none` intent. Survivor fixes and baseline files reach this branch only by merging `origin/main`.
- R4. Before merge, one run of the caller on `feat/mutation`, at a head whose pin satisfies R5, started by the temporary trigger of U6:
  - concludes `success`;
  - grades `@systemfsoftware/api-extractor` at or above its break threshold (100) in the report job's summary;
  - runs every job in at most 600 s, measured, not enforced by cancelling (KTD4).

  The PR body links the run with each job's time.
- R5. The pinned rev fails the run when the package grades below its break threshold, so the lane can fail on a survivor (`CONST-T3`).
- R6. The README roadmap row names the pinned rev and the cadence; the PR body names the pinned rev and every open blocker with its state.

### Acceptance Examples

- AE1. **Covers R1.** **Given** the caller on `main`, **when** a pull request is opened or a commit is pushed to `main`, **then** no mutation run starts.
- AE2. **Covers R1.** **Given** the caller on `main`, **when** it is dispatched with a ref other than `main`, **then** its mutation job is skipped.
- AE3. **Covers R4, R5.** **Given** a pin that satisfies R5, **when** the U6 run starts on `feat/mutation`, **then** it concludes `success`, the summary grades the package at or above 100, and every job is at most 600 s.
- AE4. **Covers R4, R5.** **Given** a surviving mutant, **when** the run grades the package below 100, **then** it concludes `failure`, and the PR stays unmerged until a survivor layer is on `main`, `feat/mutation` has merged `origin/main`, and a later run meets AE3.
- AE5. **Covers R3.** **Given** any head before U5, **when** `git diff --name-only origin/main...HEAD -- packages/ apps/ .changeset/` runs, **then** it prints nothing.

### Scope Boundaries

- No local mutation workflow, composite action, caller-side gate or copy of any shared step (R2). The red signal comes from the pinned rev (R5).
- No stryker run outside CI.
- No new tests: no generated-law test, no decode or verdict refusal property, before or at U5 (KTD11).
- No change to the mutate set, the package's `mutation` script or its stryker devDependencies before U5; the shared stryker toolchain moves only through the flake input, `pnpm-workspace.yaml` overrides and the lockfile.
- No mutation on the e2e app: it has no `mutation` script.

### Dependencies / Blockers

Each blocker is in systemfsoftware unless named otherwise. State as of 2026-10-13.

- **B1. #737** (open, draft, head `6db58a01`): removes `mutation-job.ts`'s `timeout --kill-after=60 <2 x target-seconds>` wrapper and widens `@systemfsoftware/stryker-config`'s peer range to stryker-js 19. Evidence: run [38120830653](https://github.com/systemfsoftware/api-extractor-effect/actions/runs/38120830653) at `1ebd34e` was killed 960 s into Stryker, with 63 of 1354 mutants done and no report.
- **B2. #744** (open, head `26442627`): stops seeded replays where no choice point exists. Evidence: the same run's dry run took 661 s, above R4's 600 s on its own.
- **B3. #733** (open, head `78826f9f`): replaces the shared job with `stryker plan`, `coverage`, `run --shard`, `merge` and `gate --baseline`, which fails the run on a break failure (R5), and moves systemfsoftware's own lane to nightly. It requires a committed `packages/api-extractor/mutation-baseline.json`, which R3 places in a separate layer on `main`.
- **B4. Survivors:** unknown until a graded run. They are killed in a separate layer on `main` (AE4).
- **B5. #747** (open, head `e2e1e71ab9`): the shared Mutation plan refuses, before Stryker starts, a package that sets its own `mutate` or would mutate a non-workflow file, and `@systemfsoftware/stryker-config` stops exporting `shardMutate`. If the U5 pin contains it, KTD7 changes as that decision states.
- **B6. Generated-law retirement** (not yet authored upstream): no systemfsoftware PR retires generated schema laws, and `main` at `763fd66399` (#746) does not contain one. U5 waits for it.

### Sources

- systemfsoftware `02bf9653b1ca2b0a2951baf2743bb3f70d19fc77` (#735): `.github/workflows/reusable-mutation.yml`, `scripts/tools/mutation-job.ts`, `scripts/tools/build-mutation-summary.ts`, `scripts/tools/test-timings.ts`; `CONSTITUTION.md`.
- systemfsoftware #733 (`78826f9f59`): `.github/workflows/mutation.yml` (nightly `schedule` plus `workflow_dispatch`, a concurrency group per run id, the cost header) and its body's cadence section (the 14:10-15:10 UTC window).
- systemfsoftware #737, #744 and #747, at the heads above; #733's cadence section names nightly on `main`, never per push or per PR, as the house rule.
- GitHub Docs, "Events that trigger workflows": a scheduled workflow runs on the latest commit of the default branch, and in a public repository it is disabled after 60 days without repository activity; `workflow_dispatch` fires only for a workflow file on the default branch. GitHub Docs, "Notifications for workflow runs": a scheduled run's notifications go to the user who last modified the cron syntax.
- ci-wall-clock pack at systemfsoftware `8d071180798f9ea82ef5a4fd877152dacc02f6b6`: `heavy-suites-judge-every-main-commit`, `heavy-lanes-state-their-daily-minutes`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One caller file, `.github/workflows/mutation.yml`, calls `reusable-mutation.yml` pinned by full SHA.** The shared job checks out its tools at `job.workflow_sha`, so the pin fixes the workflow and its tools together. Today's pin is `02bf965` (#735). Covers R2.
- KTD2. **Permissions: `contents: read` at the top; the mutation job grants `contents: read` and `actions: write`,** the most the called jobs request. Covers R2.
- KTD3. **Concurrency `mutation-${{ github.run_id }}`, `cancel-in-progress: false`.** Every run has its own group, so a dispatch never replaces the nightly run and the nightly run never replaces a dispatch. The shared caches are keyed by run id. This is #733's shape. Covers R1.
- KTD4. **Inputs at `02bf965`: `target-seconds: 480`, `max-jobs: 20`, `timeout-minutes: 60`, `report-timeout-minutes: 60`, each explicit.** A timeout is a backstop for a stuck job, never a budget enforced by cancelling. `sfs-deps-installable` keeps its default, `.#sfs-deps`. Re-derived at every re-pin from the pinned rev's inputs (#733 removes `max-jobs`). Covers R2, R4.
- KTD5. **Triggers: `schedule` with cron `47 14 * * *`, and `workflow_dispatch`; the mutation job carries `if: github.ref == 'refs/heads/main'`.** A schedule already runs only on the default branch; the condition makes a dispatch on any other ref skip the job (AE2). 14:47 UTC sits inside the 14:10-15:10 window #733 measured as the org's quietest hour, 30 minutes after systemfsoftware's own 14:17 run starts. The root ruled the cadence on 2026-10-13: nightly plus manual dispatch on `main`, never per push or per pull request. That departs from the ci-wall-clock rule `heavy-suites-judge-every-main-commit`, which asks for a run on every push to `main`; the ruling decides, and the PR body records the conflict. Covers R1.
- KTD6. **The proof reads the package's summary row, not only the run's conclusion.** Covers R4.
- KTD7. **The mutate set stays as PR2 shipped it: `shardMutate(['src/**/*.workflow.ts', 'src/**/*.schema.ts'])`,** the decision code `AGENTS.md:12` names (`CONST-T12`). Narrowing it inside the PR whose merge it grades would weaken the grader (`CONST-E7`). If the U5 pin contains #747 (B5), the shared package no longer exports `shardMutate` and refuses an own `mutate`, so `stryker.config.ts` drops `mutate` and spreads the shared config, and `AGENTS.md:12` is restated to name only `*.workflow.ts` as mutated. That narrowing comes from the pinned house rule, not from this PR, and the PR body names it.
- KTD8. **Release intent `none`.** Before U5 no path under `packages/` changes, so the PR carries no intent file and the Changeset Check reports that no publishable package changed (runs on `05f44c0` and earlier heads). At U5 the removal KTD11 names changes `packages/api-extractor` without changing its tarball, and an intent `"@systemfsoftware/api-extractor": none` records that. The tarball's sha512 must equal the `v0.0.0` tag's integrity at every head, so the `none` never meets `tag-integrity-mismatch`.
- KTD9. **The stryker toolchain comes from one stryker-js-effect commit, `9e81669b84711a9635eaa97b17dd13efea9f0c8c`** (stryker-js 19.0.0, ignorer 0.3.0), through the `stryker-published` flake input, the `pnpm-workspace.yaml` overrides and the lockfile. `ci.yml`'s `consumer-store` check enforces that the lockfile's integrities match the flake's tarballs.
- KTD10. **The caller states its cost in a header comment** (`heavy-lanes-state-their-daily-minutes`): one scheduled run a night plus each dispatch, priced from run 38120830653's six jobs (1,469 job-seconds). That run was cut 960 s into Stryker (B1), so the header labels the figure as a floor; U6 replaces it with a graded run's measurement.
- KTD11. **The re-pin (U5) to the systemfsoftware commit that retires generated schema laws (B6) removes this package's retired wiring and adds no replacement.** Removed: the `inlineSchemaTests()` plugin in `packages/api-extractor/vitest.config.ts`, the generated `src/schema-laws.test.ts`, the `@systemfsoftware/effect-schema-law` and `@systemfsoftware/effect-schema-vite` devDependencies with their `.sfs-deps` members and overrides, and every in-source `import.meta.vitest` decode or verdict refusal property in `src/` at that time. If the pinned rev also retires in-source tests, tsdown's `import.meta.vitest` define and the `stryker-ignorer-in-source-vitest-block` ignorer go too. Kept: `src/__tests__/judge-surfaces.workflow.property.test.ts`. It is the decision cell's own property suite, not in-source and not generated, and it kills the lane's workflow mutants. No generated-law test or refusal property replaces the removed ones, now or at U5. The test-layer matrix requires codec laws for `schema` cells. The root ruling of 2026-10-13 retires them without replacement, and the ruling decides.

### Assumptions challenged (destructive review)

- *"The nightly run always happens."* GitHub may delay a scheduled run under load, and disables a public repository's schedules after 60 days without activity. A missed night produces no verdict; a dispatch on `main` replaces it.
- *"A red night reaches someone."* A scheduled run has no pull request and no pusher. GitHub notifies the user who last changed the cron. The red-main P0 handler (`red-main-reverts-its-culprit-same-day`) is not in this PR; the PR body lists it as open.
- *"A branch proof run is a dispatch."* `workflow_dispatch` fires only for a workflow on the default branch, and the KTD5 condition skips any other ref. So the pre-merge proof uses a temporary trigger on `feat/mutation` (U6), removed before the final head.

### Risks

- #733 changes the caller interface. U5 re-derives the inputs, permissions and sizing from the pinned rev.
- A cold incremental cache makes the first graded run cover all 1354 mutants.
- The shared workflow's tag-pinned actions are outside the SHA pin; that is an upstream question.

---

## Implementation Units

### U1. README row (done; amended by U7)

The "Mutation testing on `main`" row names the pinned rev (R6). **Files:** `README.md`.

### U2. Caller pinned to `02bf965` (done; amended by U7)

`.github/workflows/mutation.yml` per KTD1, KTD2, KTD4. **Files:** `.github/workflows/mutation.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` (60-minute timeouts), `AGENTS.md`.

### U3. Stryker toolchain at stryker-js-effect `9e81669` (done)

KTD9. **Files:** `flake.nix`, `flake.lock`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

### U4. Restore the PR2 mutate set; no intent (done)

KTD7, KTD8. **Files:** `packages/api-extractor/stryker.config.ts` returns to `main`'s bytes; `.changeset/young-lamps-add.md` is deleted.

### U7. Nightly cadence

- **Approach:** set the triggers, the job condition and the concurrency group per KTD3 and KTD5; add the KTD10 cost header; restate the cadence in `AGENTS.md`'s mutation rule and the README row.
- **Files:** `.github/workflows/mutation.yml`, `AGENTS.md`, `README.md`.
- **Verification:** `actionlint` exits 0; AE5 prints nothing.

### U5. Re-pin past #733

- **Dependencies:** B1, B3 and B6 merged; `packages/api-extractor/mutation-baseline.json` on `main` in a separate layer.
- **Approach:** pin the first systemfsoftware `main` commit containing #733, #737 and B6 whose runs all concluded success; re-derive inputs and permissions from that rev (KTD4); apply KTD11 with its `none` intent (KTD8), and KTD7's change if the rev contains #747; update the README row and the PR body (R6). These package edits ship in the re-pin commit: an earlier removal would drop laws upstream still ships, and a later one would leave the flake naming tarballs the pinned rev no longer builds.
- **Verification:** `actionlint` exits 0; `git merge-base --is-ancestor <pin> origin/main` in a systemfsoftware clone exits 0; the tarball's sha512 equals the `v0.0.0` tag's integrity; `pnpm test` passes in CI with no generated-law test file.

### U6. Proof run

- **Dependencies:** U5 and B2.
- **Approach:** one commit adds `push: branches: [feat/mutation]` and widens the KTD5 condition to that ref; watch the run with `xd://github` `run_watch`, read the summary row and every job's time, record them in the PR body; the next commit restores R1's triggers and condition. A below-break grade follows AE4.

---

## Verification Contract

| Gate | Applies to | Done signal |
| --- | --- | --- |
| `git diff --name-only origin/main...HEAD -- packages/ apps/ .changeset/` | every head before U5 | prints nothing (R3) |
| `ci.yml` and Changeset Check on the PR head | every head | green |
| `nix run nixpkgs#actionlint -- .github/workflows/*.yml` | U7, U5, U6 | exit 0 |
| `sha512` of `.#workspace-tarballs`' `api-extractor-0.0.0.tgz` vs the `v0.0.0` tag annotation's `integrity` | every head | equal (KTD8) |
| `git -C <systemfsoftware clone> merge-base --is-ancestor <pin> origin/main` | U5 | exit 0 |
| The U6 run of `mutation.yml` on `feat/mutation` | U6 | AE3 |

---

## Definition of Done

- U5, U6 and U7 are done; R1-R6 hold at the final head.
- The PR body links the U6 run with its graded score and per-job times.
- Until then the PR stays a draft, and its body lists B1-B6 with their state.
