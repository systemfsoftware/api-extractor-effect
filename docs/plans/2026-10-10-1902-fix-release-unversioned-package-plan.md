---
title: Release Unversioned Package - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Release Unversioned Package - Plan

## Goal Capsule

- **Objective:** a push to `main` runs the Release workflow green, and no new tag or GitHub Release is created until `@systemfsoftware/api-extractor` has a versioned release with a changelog.
- **Means:** the package stays `private` until its first release, the root manifest carries the version surface the version step reads, and `release.yml` takes a guarded `workflow_dispatch` (KTD1, KTD2, KTD3).
- **Authority:** this plan, then `AGENTS.md`, then `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`. That plan's KTD19 owns the release callers, and KTD3 here extends its trigger list without editing it.
- **Stop conditions:** evidence that the defect is in pnpm-release-management rather than this caller's config stops the work for a report. Deleting the remote tag `@systemfsoftware/api-extractor@v0.0.0` needs operator approval and is not part of this plan.
- **Execution profile:** one PR off `main` (branch `fix/release-unversioned`). The agent opens it. The operator merges.

---

## Product Contract

### Summary

Mark `@systemfsoftware/api-extractor` `private` until its first versioned release. Give the root `package.json` a `version` of `0.0.0`, as every other family repository's root has. Let `release.yml` run on `workflow_dispatch`, with the reusable release job guarded to `refs/heads/main` so a branch dispatch does nothing.

### Problem Frame

Release on `main` at `b7e907a` failed (run 38076109214, job "release · tag · GitHub releases"): `Missing changelog for @systemfsoftware/api-extractor@0.0.0`. The plan job had picked `phase=release` (`pending_intents=1 this_cycle=1`). pnpm-release-management at the pinned `b9b4a1d48c` treats every publishable member whose `<name>@v<version>` tag is missing as owed a release (`packages/github-release-engine/src/cycle.ts:20-22`). An owed cycle outranks pending intents (`plan-release.workflow.ts:55-60`). A member is publishable when its manifest is not `private` (`packages/process-adapter/src/evidence-io.ts:78`). The package was never versioned, so no changelog exists.

The release job tags before it publishes the GitHub Releases (`release.yml:134-144`), so the failed run left the tag `@systemfsoftware/api-extractor@v0.0.0` on origin.

The version step would fail as well. `version-management bump` reads the root `package.json` as the version manifest (`packages/version-engine/src/bump.ts:54`). This root has no `version`, so bump refuses with `VersionIntentMalformed: path=package.json`. A local run of the pinned tool on `origin/main` shows this.

### Requirements

**Release behaviour**

- R1. A push to `main` with pending intents and no versioned package plans `phase=version` and passes the version step. It never plans `phase=release`.
- R2. The version step consumes the pending `none` intent without changing a version or writing a changelog.
- R3. The changeset check passes on a PR that touches only the private package.

**Proof trigger**

- R4. `release.yml` accepts `workflow_dispatch`. A dispatch on any ref other than `refs/heads/main` runs no reusable release job and ends green.

**Docs**

- R5. `.changeset/README.md` says the package is private until its first release, and names what has to happen before the PR that makes it public.

### Key Decisions

- **The defect is in this caller's config, not in the shared planner.** The family keeps a package that has never been released `private`. pnpm-release-management's members are all private and its pushes settle to `phase=version` or `none`. systemfsoftware kept `stryker-config` private at 0.1.0 (`2506fc97d4`) until #707 (`732f66a0c8`) made it public in the same commit that added its changelog. Governs R1, R2.

### Scope Boundaries

- The non-atomic tag-then-release order in pnpm-release-management's `release.yml` is an upstream question, not a change here.
- The remote tag `@systemfsoftware/api-extractor@v0.0.0` stays. Deleting it is a destructive remote change that needs operator approval (Open Questions).
- Not built: a caller-side plan-only job on dispatch. It would copy the reusable workflow's plan step into this repository, which `AGENTS.md` forbids. The local runs of the pinned tools (Verification Contract) prove R1-R3. It would be worth building only if the reusable workflow offered a dry-run input.
- Not built: a changeset intent for this PR. With the package private, the paths gate needs none (R3).

#### Deferred to Follow-Up Work

- PR6 (consumer-flake journey) removes `private` and names the first non-`none` bump, which the main plan already holds open as "Deferred to the root (PR2)".

### Open Questions

- **Operator: delete the tag `@systemfsoftware/api-extractor@v0.0.0`?** It records the integrity of a 0.0.0 tarball. While the package is private it does nothing: the plan with the tag present gives `phase=version`. If the package becomes public while still at 0.0.0, which PR6 does if `private` goes before the version bump lands, the plan refuses with `tag-integrity-mismatch` as soon as the tarball changes. A local probe showed this refusal. Deleting the tag, or making PR6 bump the version in the same release PR that removes `private`, avoids it.
- **Upstream (pnpm-release-management): should the release job check for the changelog before it pushes tags?** Today a missing changelog leaves a tag with no GitHub Release.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`"private": true` on `packages/api-extractor/package.json` until the first release.** `cycleOf` drops a private member, so a missing tag stops counting as owed. `workspace-tarballs` becomes empty, and the plan does no integrity check on it. A hand-written changelog or a hand-edited package version would satisfy the release step without the version step ever running, and the request forbids both. A deferral list does not help: the reusable `release.yml:63` passes no `--deferred` to the plan. KTD2 alone would also get past today's failure, because the stray tag already makes the cycle empty, but it leaves the package public at a burned 0.0.0. A local probe shows the next change to its tarball refuses with `tag-integrity-mismatch`. Governs R1, R3.
- KTD2. **Root `package.json` gets `"version": "0.0.0"`.** This is the version surface the changesets strategy reads (`bump.ts:54`, `SurfaceStoreLive.ts:42`), and the root manifests of systemfsoftware, stryker-js-effect and pnpm-release-management all carry `0.0.0`. It is not a package version: the root is private and has no tarball. Without it R1 fails at the version step. Governs R1, R2.
- KTD3. **`workflow_dispatch` on `release.yml`. The reusable `release` job carries `if: github.ref == 'refs/heads/main'`, and a caller `noop` job carries the inverse guard.** The `noop` job prints that Release writes only from `main`. It is needed because a run whose every job is skipped concludes `skipped`, not `success` (stryker-js-effect runs 37921728551 and 38040479059). With the `noop` job, a branch dispatch ends green, as R4 requires. The trigger was a user directive and is challenged here once. systemfsoftware's `.github/AGENTS.md:23` says "Never re-trigger a release by hand", and a dispatch on `main` is exactly that: a full release run with write grants. The guard keeps a branch dispatch read-only. Whether the trigger stays after the proof run is the operator's call. The trigger is kept as directed. Governs R4.

### Assumptions

- `attw --pack` and the `consumer-store` check do not depend on the package being publishable. CI confirms both.
- `release.yml` already exists on `main` and has run, so `gh workflow run release.yml --ref <branch>` runs the branch's copy, which carries the trigger ([cli/cli#9781](https://github.com/cli/cli/issues/9781), comments of 2025-03-26 and 2026-04-05). GitHub's docs say only that the file must exist on the default branch. If GitHub refuses the dispatch because `main`'s copy has no `workflow_dispatch`, R4 is proven after merge by dispatching on a branch other than `main`.
- The version job's `github-release-management pr` labels the release PR `release` (`apps/github-release-management/src/boundary.ts:161`), and `ForgeLive.ts` fails the job on any non-404 error. This repository has no `release` label. systemfsoftware, stryker-js-effect and are-the-types-wrong-effect each carry one (colour `0E8A16`, "Automated version-packages release PR").

### Flow check

A single-pass trace, not a subagent run:

1. PR push: the changeset check sees no publishable change. CI builds an empty `workspace-tarballs` (R3).
2. Merge to `main`: plan gives `phase=version`. Bump consumes the intent with no version change. The version job opens the release PR and dispatches `ci.yml` there, which already accepts `workflow_dispatch` (R1, R2).
3. Release PR merged: no pending intents and no owed cycle, so `phase=none`.
4. Dispatch on this branch: the `release` job is skipped and the `noop` job succeeds (R4).
5. Dispatch on `main`: the same as a push (KTD3 challenge).

---

## Implementation Units

### U1. Keep the unversioned package out of release

- **Goal:** the planner stops treating 0.0.0 as owed, and the version step can read its manifest.
- **Requirements:** R1, R2, R3, R5. KTD1, KTD2.
- **Dependencies:** none.
- **Files:** `packages/api-extractor/package.json`, `package.json`, `.changeset/README.md`.
- **Approach:**
  1. Add `"private": true` after `version` in the package manifest.
  2. Add `"version": "0.0.0"` after `name` in the root manifest.
  3. Correct the README: a PR that changes a *publishable* package ships an intent. Add a bullet saying the package is private until its first release, that the PR making it public names its first bump, and the tag precondition (Open Questions).
  4. Create the repository label `release` with the sibling repositories' colour and description. This is a GitHub setting, not a file, so the PR body records it.
- **Execution note:** this is config only. Prove it with the pinned release tools against a throwaway worktree before pushing, not with a unit test.
- **Test expectation:** none. This is manifest data. A test would restate the configuration, which OP12 forbids.
- **Verification:** the pinned `github-release-management plan` reports `phase=version` both with and without the remote tag. `version-management bump` exits 0 with "consumed intents without a version bump". `changeset-management check origin/main` exits 0. `gh label list` shows `release`.

### U2. Guarded manual trigger for Release

- **Goal:** Release can be dispatched for proof without writing anything off `main`.
- **Requirements:** R4. KTD3.
- **Dependencies:** none.
- **Files:** `.github/workflows/release.yml`.
- **Approach:** add `workflow_dispatch` under `on`, the ref guard on the `release` job, and the `noop` job (KTD3). Extend the header comment with one sentence on what the guard prevents.
- **Test expectation:** none. This is workflow wiring.
- **Verification:** `gh workflow run release.yml --ref fix/release-unversioned` produces a run that concludes `success`, with the `release` job `skipped` and the `noop` job `success`. If GitHub refuses that dispatch, the same check runs after merge on a branch other than `main` (Assumptions).

---

## Verification Contract

| Gate | Command | Proves |
|---|---|---|
| Lint, typecheck, build, test | `nix develop --command pnpm turbo run lint typecheck build test --force` | No regression from the manifest edits |
| attw | `nix shell .#attw --command bash -c 'cd packages/api-extractor && attw --pack . --profile esm-only'` | A private package still packs and resolves |
| Store | `nix build .#checks.x86_64-linux.consumer-store` | The lockfile integrities still match |
| Release plan | the pinned `github-release-management plan --tarballs <workspace-tarballs>` in a throwaway worktree | R1 |
| Version step | the pinned `version-management bump` in a throwaway worktree | R2 |
| Changeset gate | the pinned `changeset-management check origin/main` | R3 |
| CI | `ci.yml` and Changeset Check green on the PR head, each job 10 minutes or less | R3 |
| Release label | `gh label list -R systemfsoftware/api-extractor-effect` shows `release` | R1 (the version job's PR step) |
| Dispatch | Release `workflow_dispatch` on a branch other than `main`: conclusion `success`, `release` skipped, `noop` success | R4 |

## Definition of Done

- U1 and U2 are on `fix/release-unversioned`, and every gate above has passed and been observed.
- The PR is open against `main`, and its body records the root cause, the probe outputs and the two Open Questions.
- No throwaway worktree, remote or probe file remains.
