---
title: Mutation Caller - Plan
type: ci
date: 2026-10-12
topic: mutation-caller
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-10-2149-ci-mutation-caller-plan.md
---

# Mutation Caller - Plan

## Goal Capsule

- **Objective:** every push to `main` runs mutation testing on `@systemfsoftware/api-extractor`'s verdict-decision code, and a surviving mutant turns `main` red. The decision code is `src/**/*.workflow.ts` and the `src/**/*.schema.ts` files beside the types it operates on (`AGENTS.md:12`).
- **Means:** a thin caller, `.github/workflows/mutation.yml`, of systemfsoftware's shared `reusable-mutation.yml`, pinned by full SHA.
- **Scope:** CI and dev toolchain only. No path under `packages/` or `apps/` changes, the package tarball stays byte-identical to the one the `@systemfsoftware/api-extractor@v0.0.0` tag records, and the PR carries no changeset intent.
- **Authority:** systemfsoftware `CONSTITUTION.md` and the Compound Packs in `.compound-engineering/config.yaml` bind first; a brief that conflicts with them goes to the operator. Then this plan, then `AGENTS.md`, then `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md` (KTD20). The 1146 plan's KTD18 timeout values (10 minutes) are superseded by KTD4 here.
- **Supersedes** `docs/plans/2026-10-10-2149-ci-mutation-caller-plan.md`, which stays as the contract its executed units (U1, U2, the two proof runs) were verified against. Carried forward: its R1, R2, R4, R5 and KTD1-KTD6 as amended by its Timeout, U2 and Proof run rulings. Withdrawn: its Mutate-set ruling (KTD7 here). Met and dropped: its R3 (the caller is pinned).
- **Execution profile:** the mutation-caller PR on `feat/mutation`, a `gh stack` layer on `main`, a draft until the Definition of Done holds. The agent commits and pushes; the operator merges.
- **Stop conditions:**
  - A unit needs a path under `packages/` or `apps/`: stop; that work is a separate layer on `main` (R3).
  - The pin for the proof run does not satisfy R5: no merge.
  - A proof-run job exceeds 600 s, or the summary grades below the break threshold: stop and report; R4 holds the merge.

---

## Product Contract

### Requirements

- R1. At this PR's final head the caller runs only on push to `main` and on `workflow_dispatch`; it never has a `pull_request` or `merge_group` trigger.
- R2. The caller is a thin `workflow_call` of `reusable-mutation.yml` pinned by commit SHA, with only that workflow's inputs and the permissions its jobs ask for.
- R3. This PR's own commits change no path under `packages/` or `apps/` and add no `.changeset/` intent. Survivor fixes and baseline files reach this branch only by merging `origin/main`.
- R4. Before merge, one `workflow_dispatch` run of the caller on `feat/mutation`, at a head whose pin satisfies R5:
  - concludes `success`;
  - grades `@systemfsoftware/api-extractor` at or above its break threshold (100) in the report job's summary;
  - runs every job in at most 600 s, measured, not enforced by cancelling (KTD4).

  The PR body links the run with each job's time.
- R5. The pinned rev fails the run when the package grades below its break threshold, so the lane can fail on a survivor (`CONST-T3`).
- R6. The README roadmap row names the pinned rev; the PR body names the pinned rev and every open blocker with its state.

### Acceptance Examples

- AE1. **Covers R1.** **Given** the caller on `main`, **when** a pull request is opened, **then** no mutation run starts.
- AE2. **Covers R4, R5.** **Given** a pin that satisfies R5, **when** the caller is dispatched on `feat/mutation`, **then** the run concludes `success`, the summary grades the package at or above 100, and every job is at most 600 s.
- AE3. **Covers R4, R5.** **Given** a surviving mutant, **when** the dispatch run grades the package below 100, **then** the run concludes `failure`, and the PR stays unmerged until a survivor layer is on `main`, `feat/mutation` has merged `origin/main`, and a later dispatch meets AE2.
- AE4. **Covers R3.** **Given** any head of this PR, **when** `git diff --name-only origin/main...HEAD -- packages/ apps/ .changeset/` runs, **then** it prints nothing.

### Scope Boundaries

- No local mutation workflow, composite action, caller-side gate or copy of any shared step (R2). The red signal comes from the pinned rev (R5).
- No stryker run outside CI.
- No change to the mutate set, the package's `mutation` script or its stryker devDependencies; the shared stryker toolchain moves only through the flake input, `pnpm-workspace.yaml` overrides and the lockfile.
- No mutation on the e2e app: it has no `mutation` script.

### Dependencies / Blockers

Each blocker is in systemfsoftware unless named otherwise. State as of 2026-10-12.

- **B1. #737** (open, draft, head `a2a58d08`): removes `mutation-job.ts`'s `timeout --kill-after=60 <2 x target-seconds>` wrapper and widens `@systemfsoftware/stryker-config`'s peer range to stryker-js 19. Evidence: proof run [38120830653](https://github.com/systemfsoftware/api-extractor-effect/actions/runs/38120830653) at `1ebd34e` was killed 960 s into Stryker, with 63 of 1354 mutants done and no report.
- **B2. #744** (open, the S2 unit): stops seeded replays where no choice point exists. Evidence: the same run's dry run took 661 s of wall time, above R4's 600 s on its own; Stryker always runs the dry run, so no mutate set avoids it (StrykerJS docs, "Incremental").
- **B3. #733** (open, head `558d1c32f`): replaces the shared job with `stryker plan`, `coverage`, `run --shard`, `merge` and `gate --baseline`, which fails the run on a break failure. That satisfies R5; `02bf965` does not, because its mutation job fails only when no report was written (`mutation-job.ts:162`, `build-mutation-summary.ts:142-143`). #733 requires a committed `packages/api-extractor/mutation-baseline.json`, which R3 places in a separate layer on `main`.
- **B4. Survivors:** unknown until a graded run. They are killed in a separate layer on `main` (AE3).

### Sources

- systemfsoftware `02bf9653b1ca2b0a2951baf2743bb3f70d19fc77` (#735): `.github/workflows/reusable-mutation.yml`, `scripts/tools/mutation-job.ts`, `scripts/tools/build-mutation-summary.ts`, `scripts/tools/test-timings.ts`; `CONSTITUTION.md`.
- systemfsoftware #733, #737 and #744, at the heads above.
- `@systemfsoftware/stryker-js` 19.0.0 `CHANGELOG.md` (empty mutate sets and fileless shards pass).
- pnpm-release-management `b9b4a1d48cc16241b33f9afd8ab99b82b05ce04f`: `github-release-engine` `cycleOf` and `verifyIntegrity`.
- StrykerJS docs, "Incremental": https://stryker-mutator.io/docs/stryker-js/incremental/

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One caller file, `.github/workflows/mutation.yml`, calls `reusable-mutation.yml` pinned by full SHA** (`mutation.yml:20`). The shared job checks out its tools at `job.workflow_sha`, so the pin fixes the workflow and its tools together. Today's pin is `02bf965` (#735). Covers R2.
- KTD2. **Permissions: `contents: read` at the top; the mutation job grants `contents: read` and `actions: write`,** the most the called jobs request. A called job cannot widen the caller's grant. Covers R2.
- KTD3. **Concurrency `mutation-${{ github.sha }}`, `cancel-in-progress: false`.** No merge's run cancels or replaces another's; the shared caches are keyed by run ID, so concurrent runs do not overwrite each other's entry. Covers R1.
- KTD4. **Inputs at `02bf965`: `target-seconds: 480`, `max-jobs: 20`, `timeout-minutes: 60`, `report-timeout-minutes: 60`, each explicit.** A timeout is a backstop for a stuck job, never a budget enforced by cancelling: every job and step timeout in this repository is 60 minutes, and the 600 s job budget is measured and reported. `sfs-deps-installable` keeps its default, `.#sfs-deps`. Re-derived at every re-pin from the pinned rev's inputs (#733 removes `max-jobs`). Covers R2, R4.
- KTD5. **Triggers: `push` with `branches: [main]`, and `workflow_dispatch`.** The shared `mutation-event-guard` also refuses pull-request events, but a trigger that never fires is the cheaper guarantee. Covers R1.
- KTD6. **The proof reads the package's summary row, not only the run's conclusion.** Covers R4.
- KTD7. **The mutate set stays as PR2 shipped it: `shardMutate(['src/**/*.workflow.ts', 'src/**/*.schema.ts'])`.**
  - It is the decision code `AGENTS.md:12` names, chosen by what the code does (`CONST-T12`).
  - Narrowing it inside the PR whose merge it grades would weaken the grader (`CONST-E7`).
  - One matched file cannot be sharded: at `02bf965` mutation packages are always shardable (`test-timings.ts:455`), the planner sizes shards by recorded seconds (`:211-212`) and records a sharded package as the sum of its shards (`:355`), and stryker-js 19.0.0 runs a full dry run for a shard with no file.
  - It cannot fix the time budget: the dry run is the dominant cost (B2).
- KTD8. **No changeset intent.** No path under `packages/` changes, so the Changeset Check has nothing to require (run 38131376753 passed on `7d3dbc6` with no intent). On merge, Release finds no pending intent, and the `v0.0.0` tag already exists for the byte-identical tarball, so no release is owed (`github-release-engine/src/cycle.ts:22`); Release on `main` concluded `success` in the same state (run 38093132532 at `9bd7396`).
- KTD9. **The stryker toolchain comes from one stryker-js-effect commit, `9e81669b84711a9635eaa97b17dd13efea9f0c8c`** (stryker-js 19.0.0, ignorer 0.3.0), through the `stryker-published` flake input, the `pnpm-workspace.yaml` overrides and the lockfile. `ci.yml`'s `consumer-store` check enforces that the lockfile's integrities match the flake's tarballs. The ignorer's handling of `recursionBudget` is exercised by every mutation dry run over the schema files that carry it (`model/api-model.schema.ts:145`, `model/type-expr.schema.ts:170,189`).

### Risks

- #733 changes the caller interface. The re-pin (U5) re-derives the inputs, permissions and sizing from the pinned rev.
- A cold incremental cache makes the first graded run cover all 1354 mutants; Stryker saves an interrupted run's partial results to its incremental file.
- The shared workflow's tag-pinned actions (`actions/cache@v6`, `denoland/setup-deno@v2`) are outside the SHA pin; that is an upstream question.

---

## Implementation Units

### U1. README row (done)

The "Mutation testing on `main`" row names the pinned rev (R6). **Files:** `README.md`.

### U2. Caller pinned to `02bf965` (done)

`.github/workflows/mutation.yml` per KTD1-KTD5. **Files:** `.github/workflows/mutation.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` (60-minute timeouts), `AGENTS.md`.

### U3. Stryker toolchain at stryker-js-effect `9e81669` (done)

KTD9. **Files:** `flake.nix`, `flake.lock`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

### U4. Restore the PR2 mutate set; no intent

KTD7, KTD8. **Files:** `packages/api-extractor/stryker.config.ts` returns to `main`'s bytes; `.changeset/young-lamps-add.md` is deleted. **Verification:** AE4 prints nothing; the tarball's sha512 equals the `v0.0.0` tag's integrity.

### U5. Re-pin past #733

- **Dependencies:** B1 and B3 merged; `packages/api-extractor/mutation-baseline.json` on `main` in a separate layer.
- **Approach:** pin the first systemfsoftware `main` commit containing #733 and #737 whose runs all concluded success; re-derive inputs and permissions from that rev (KTD4); update the README row and the PR body (R6).
- **Verification:** `actionlint` exits 0; `git merge-base --is-ancestor <pin> origin/main` in a systemfsoftware clone exits 0.

### U6. Proof dispatch

- **Dependencies:** U5 and B2.
- **Approach:** dispatch the caller with `--ref feat/mutation`, watch it with `xd://github` `run_watch`, read the summary row and every job's time, and record them in the PR body. A below-break grade follows AE3.

---

## Verification Contract

| Gate | Applies to | Done signal |
| --- | --- | --- |
| `git diff --name-only origin/main...HEAD -- packages/ apps/ .changeset/` | every head | prints nothing (R3) |
| `ci.yml` and Changeset Check on the PR head | every head | green |
| `nix run nixpkgs#actionlint -- .github/workflows/*.yml` | U2, U5 | exit 0 |
| `sha512` of `.#workspace-tarballs`' `api-extractor-0.0.0.tgz` vs the `v0.0.0` tag annotation's `integrity` | every head | equal (KTD8) |
| `git -C <systemfsoftware clone> merge-base --is-ancestor <pin> origin/main` | U5 | exit 0 |
| Dispatch run of `mutation.yml` on `feat/mutation` | U6 | AE2 |

---

## Definition of Done

- U4, U5 and U6 are done; R1-R6 hold at the final head.
- The PR body links the U6 run with its graded score and per-job times.
- Until then the PR stays a draft, and its body lists B1-B4 with their state.
