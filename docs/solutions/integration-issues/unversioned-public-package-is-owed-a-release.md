---
title: A public package at 0.0.0 with no release tag is owed a release that has no changelog
date: 2026-10-10
category: integration-issues
module: release workflow (pnpm-release-management caller)
problem_type: integration_issue
component: tooling
symptoms:
  - "Release on main fails in the job \"release · tag · GitHub releases\" with `Missing changelog for @systemfsoftware/api-extractor@0.0.0`"
  - The failed run leaves the tag `@systemfsoftware/api-extractor@v0.0.0` on origin with no GitHub Release
  - "Without a root `version`, `version-management bump` refuses with `VersionIntentMalformed` (path=package.json)"
root_cause: incomplete_setup
resolution_type: config_change
severity: high
tags: [release, pnpm-release-management, changelog, private-package, workspace-tarballs, root-version, release-pack-candidate]
---

# A public package at 0.0.0 with no release tag is owed a release that has no changelog

**Release pack candidate.** This applies to every systemfsoftware family repository that calls pnpm-release-management, not only this one. It is a candidate rule for the systemfsoftware release pack.

## Problem

The first push to `main` with Release wired (`b7e907a`, run 38076109214) failed. `@systemfsoftware/api-extractor` was public at `0.0.0`, had never been released and had no `CHANGELOG.md`. Release treated it as owed a `0.0.0` release and refused for want of a changelog, after it had already pushed the tag.

## Symptoms

```text
Missing changelog for @systemfsoftware/api-extractor@0.0.0
```

The remote tag `@systemfsoftware/api-extractor@v0.0.0` was left behind with no GitHub Release, because the reusable `release.yml` tags before it creates GitHub Releases.

## What Didn't Work

- **`"private": true` on the package** (`f1ff85b`, rejected and reverted in `d3e31dd`). It does take the package out of the release cycle. It also takes it out of the flake: `mkPnpmWorkspacePackages` keeps only non-private workspace members, so `.#workspace-tarballs` became `[]` and the flake lost this repository's own tarball. A family repo's product is that tarball.

## Solution

PR #3 (`627713f`):

- The package stays public at `0.0.0`.
- The root `package.json` gains `"version": "0.0.0"`, the surface the bump step reads.
- `release.yml` accepts `workflow_dispatch`, with the release job gated to `refs/heads/main` and a no-op job off `main`, so a manual dispatch on a branch writes nothing.

The `v0.0.0` tag the failed run pushed stays. With it on origin, the pinned `github-release-engine plan` at PR #3's head gave `phase=version` and the bump consumed the pending intent without moving a version (probe recorded in PR #3's body). The tag is deleted only in the change that moves the version off `0.0.0` (`.changeset/README.md`).

## Why This Works

All three mechanisms are in pnpm-release-management at `b9b4a1d48cc16241b33f9afd8ab99b82b05ce04f`, the commit this repository's release callers pin.

1. **Who is owed a release.** `cycleOf` in the `github-release-engine` package builds the cycle from every member that is publishable, has no `<name>@v<version>` tag on the remote and has no legacy release. Each `CycleEntry` carries the changelog path for that version. A public `0.0.0` member with no tag is therefore owed `0.0.0`, and that release needs a changelog the repository never wrote.
2. **Why `private` is the wrong lever.** `mkPnpmWorkspacePackages` keeps only the members whose manifest is not `private` (its `public` binding), and only those become tarballs. A private member leaves the release cycle and the flake output at once.
3. **Why the root needs a version.** `version-engine`'s bump reads the version surface of the root manifest (`request.manifest`) before it plans anything. A new repository's root `package.json` has no `version`, so the bump refuses before it looks at intents.

Invariant, over every public workspace member $m$ when Release runs on `main`:

$$\text{tag}(m) \notin \text{remoteTags} \implies \text{changelog}(m, \text{version}(m)) \text{ exists}$$

## Prevention

- Before Release first runs on `main`, every public workspace member has either its `<name>@v<version>` tag on origin or a `CHANGELOG.md` entry for its current version. A new family repo ships its first version's changelog in the same change that wires Release.
- The root `package.json` of every repository that calls pnpm-release-management carries a `version`.
- Never mark a package `private` to keep it out of a release. It also drops the package's tarball from `mkPnpmWorkspacePackages`.
- While a public package sits at a version whose tag exists, a change to its tarball ships a non-`none` intent; with `none`, the plan refuses with `tag-integrity-mismatch` (`.changeset/README.md`).

## Related Issues

- Plan: `docs/plans/2026-10-10-2113-fix-release-version-surface-plan.md`.
- PR #3, systemfsoftware/api-extractor-effect: the probe outputs and the rejected `private` approach.
- Open upstream question for pnpm-release-management: check for the changelog before pushing tags, so a refused release leaves no tag.
