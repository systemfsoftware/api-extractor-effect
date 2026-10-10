---
title: Main Release Version Surface - Plan
type: fix
date: 2026-10-10
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
supersedes: docs/plans/2026-10-10-1902-fix-release-unversioned-package-plan.md (KTD1, R3, R5, U1 step 1)
execution: code
---

# Main Release Version Surface - Plan

## Goal Capsule

- **Objective:** a push to `main` runs the Release workflow green, and no tag or GitHub Release is created without a changelog.
- **Means:** `@systemfsoftware/api-extractor` stays public at 0.0.0. The root manifest carries the version surface the version step reads. `release.yml` takes a guarded `workflow_dispatch` and runs one Release at a time per ref. The leftover tag `@systemfsoftware/api-extractor@v0.0.0` stays (KTD1-KTD4).
- **Authority:** this plan, then `AGENTS.md`, then `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`. It replaces `docs/plans/2026-10-10-1902-fix-release-unversioned-package-plan.md`: KTD1, R3, R5 and U1 step 1 are overturned, and the root cause, KTD2, KTD3 and U2 carry over into this plan.
- **Stop conditions:** if the pinned `github-release-management plan` at this PR's head, with the v0.0.0 tag on origin, gives anything but `phase=version` without `tag-integrity-mismatch`, the work stops for a report.
- **Execution profile:** PR #3, branch `fix/release-unversioned`. The agent pushes, and the operator merges.

---

## Product Contract

### Summary

Leave `@systemfsoftware/api-extractor` public at 0.0.0. Give the root `package.json` `"version": "0.0.0"`. Let `release.yml` run on `workflow_dispatch`: the reusable release job runs only on `refs/heads/main`, an off-main `noop` job keeps a branch dispatch green, and a concurrency group keeps two Release runs for one ref from overlapping. Keep the tag that the failed run pushed, and write down the rule it imposes.

### Problem Frame

Release on `main` at `b7e907a` failed (run 38076109214): `Missing changelog for @systemfsoftware/api-extractor@0.0.0`. The planner at the pinned `b9b4a1d48c` counts as owed every publishable member whose `<name>@v<version>` tag is missing (`packages/github-release-engine/src/cycle.ts:20-23`). The release job then tagged before it wrote the GitHub Releases, so the run left the tag `@systemfsoftware/api-extractor@v0.0.0` on origin. It is an annotated tag on `b7e907a` that records the 0.0.0 tarball's integrity and per-file digests. The version step would also have failed, because `version-management bump` reads the root `package.json` as the version manifest and this root had no `version`.

The superseded plan made the package `private` (f1ff85b). That was rejected: `nix/lib/pnpm-workspace-packages.nix:63` drops every private member, and `:140-144` then packs an empty set. With the package private, `.#workspace-tarballs` became `[]` and the flake lost its `api-extractor` package. That hides the product instead of releasing it.

### Requirements

- R1. After merge, a push to `main` plans `phase=version` with no `tag-integrity-mismatch`. The version step consumes the pending `none` intent without changing a version or writing a changelog.
- R2. The flake keeps its `api-extractor` package, and `.#workspace-tarballs` packs `@systemfsoftware/api-extractor`.
- R3. `release.yml` accepts `workflow_dispatch`. A dispatch on any ref other than `refs/heads/main` runs no reusable release job and ends green. Two Release runs for the same ref never run at once.
- R4. `.changeset/README.md` states the tag rule: while the package is at 0.0.0 and the v0.0.0 tag exists, a PR that changes `packages/api-extractor` ships a non-`none` intent.
- R5. The v0.0.0 tag stays. It is deleted only in the same change that moves the version off 0.0.0.

### Scope Boundaries

- The first release (the first non-`none` bump of `@systemfsoftware/api-extractor`) is the operator's decision and is not made here. This PR does not change the package tarball, so the pending `none` intent stays.
- The non-atomic tag-then-release order in pnpm-release-management's `release.yml` is an upstream question.
- No GitHub environment guards the dispatch trigger.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The package stays public at 0.0.0.** It replaces the superseded KTD1 (`"private": true`), which removed the flake's own tarball (Problem Frame). Governs R2.
- KTD2. **Root `package.json` gets `"version": "0.0.0"`** (carried from the superseded plan). This is the version surface the changesets strategy reads (`packages/version-engine/src/bump.ts:54`). Governs R1.
- KTD3. **Guarded `workflow_dispatch`, plus a concurrency group.** The trigger, the `if: github.ref == 'refs/heads/main'` guard and the `noop` job are carried from the superseded KTD3. `concurrency: {group: release-${{ github.ref }}, cancel-in-progress: false}` mirrors `are-the-types-wrong-effect`'s `release.yml:7-9`. A dispatch on `main` and a push to `main` share a group, so the second run waits. The shared reusable workflow sets no concurrency. Cancellation stays off so that a push cannot abort a release partway through tagging. Governs R3.
- KTD4. **The v0.0.0 tag is load-bearing and stays.** The planner checks integrity for every publishable member whose current-version tag exists, unless the changesets plan's releases name it (`packages/github-release-engine/src/plan.ts:121-206`). Two consequences follow while the package sits at 0.0.0:
  - A change to its tarball that ships a `none` intent fails Release with `tag-integrity-mismatch`. R4 states that rule.
  - Deleting the tag makes 0.0.0 owed again (`cycle.ts:20-23`), which brings back the original `Missing changelog` failure. A non-`none` bump exempts the member and moves the version, so the tag can go in that same change and no earlier (R5).

  Governs R1, R4, R5.

---

## Implementation Units

### U1. Keep the version surface and record the tag rule

- **Requirements:** R1, R2, R4, R5. KTD1, KTD2, KTD4.
- **Files:** `package.json`, `.changeset/README.md`.
- **Approach:** root `"version": "0.0.0"`, with `packages/api-extractor` left byte-identical to `b7e907a`. Add to the README a bullet stating the 0.0.0 tag rule and when the tag may be deleted. The repository label `release` already exists.
- **Test expectation:** none. This is manifest and doc data.

### U2. Guarded manual trigger for Release

- **Requirements:** R3. KTD3.
- **Files:** `.github/workflows/release.yml`.
- **Approach:** `workflow_dispatch`, the ref guard on `release`, the off-main `noop` job, and the `concurrency` block.
- **Test expectation:** none. This is workflow wiring.

---

## Verification Contract

| Gate | Command | Proves |
|---|---|---|
| Release plan | the pinned `github-release-management plan --tarballs "$(nix build --no-link --print-out-paths .#workspace-tarballs)"` at the PR head, against origin with the v0.0.0 tag | R1, R2 |
| Version step | the pinned `version-management bump` at the PR head, in a throwaway worktree | R1 |
| Lint, typecheck, build, test | `nix develop --command pnpm turbo run lint typecheck build test --force` | no regression |
| Host digest | `node --conditions=@systemfsoftware/source apps/api-extractor-e2e/host-digest.ts \| sha256sum` gives `e4478f03…6da2` | no regression |
| CI | `ci.yml` and Changeset Check green on the PR head | R2 |
| Off-main dispatch | Release `workflow_dispatch` on `fix/release-unversioned`: `release` skipped, `noop` success | R3, the off-main guard only |
| Main Release | the push-triggered Release on `main` after merge | R1, the release path itself |
