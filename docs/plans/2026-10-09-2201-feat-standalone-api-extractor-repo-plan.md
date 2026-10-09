---
title: Standalone api-extractor repository - Plan
type: feat
date: 2026-10-09
topic: standalone-api-extractor-repo
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Standalone api-extractor repository - Plan

## Goal Capsule

- **Objective:** `@systemfsoftware/api-extractor` has a standalone product repository. Its PR head CI proves the package builds, passes its gates and its upstream-parity lane, and can be released, and it uses only pinned systemfsoftware-family sources.
- **Means:** a fresh import of systemfsoftware/systemfsoftware PR #552 (branch `fork-api-extractor2`, head `3a135a19cbff4bbcd0396135e52a75f7f5996420`) into systemfsoftware/api-extractor-effect on branch `feat/import-api-extractor`, landed as one PR into `main`.
- **Product authority:** #552 settles the package's design. This document settles the repository's shape. Switching consumers inside systemfsoftware is not active scope.
- **Open blockers:** three required toolchain packages are private at every family flake (R6). `@systemfsoftware/stryker-test-contribution` is missing from the stryker-js-effect release set (R7). No shared reusable mutation workflow exists (R16). A `workflow_dispatch` run cannot target a workflow absent from `main` (R17). All four are in Resolve Before Planning.

---

## Product Contract

### Summary

Import #552's package into this repository as a self-contained product. It gets its own flake-sourced dependencies, CI, pinned knowledge packs, an MIT license with Microsoft's notice, and a thin-caller release flow. The monorepo's toolchain is not copied. Where a family flake cannot supply a package, the work stops and reports it as blocked.

### Key Decisions

- **Fresh import in a normal commit.** History stays in the monorepo; this repository starts from #552's tree. (session-settled: user-directed — chosen over a `git filter-repo` history import: the user asked for a plain copy commit.) Governs R1.
- **#552 is the only source; #462 contributes nothing.** (session-settled: user-directed — chosen over taking anything from #462: #552 supersedes it.) Governs R1.
- **MIT, not #552's Apache-2.0.** (session-settled: user-directed — chosen over keeping #552's Apache-2.0 package license: the port is from MIT-licensed upstream code.) Governs R19, R20.
- **Family flake tarballs or blocked; never the registry, never a vendored copy.** (session-settled: user-directed — chosen over vendoring or copying monorepo packages: a missing or deficient package is reported as blocked.) Governs R4, R5, R6, R7.
- **Knowledge packs come from a pinned git source.** (session-settled: user-directed — chosen over a local `compound-packs/` copy and over stryker-js-effect's unpinned `/tree/main` URLs.) Governs R14.
- **All four systemfsoftware packs apply.** The package composes Sandwich cells (cell-architecture), pins upstream semantics with a differential lane (boundary-testing), declares Effect schemas with laws (schema-laws), and publishes an exports map (package-topology). Governs R14.
- **If attw stays, it runs from the are-the-types-wrong-effect flake's `attw` binary.** That flake publishes a built `attw` executable and no workspace tarballs. The binary keeps #552's type-resolution check without a registry dependency. R8–R10 do not require attw, so dropping the step also meets them. Governs R12.
- **No registry publishing; GitHub Releases only.** (session-settled: user-directed — chosen over npm publishing.) Governs R15.
- **Mutation testing runs on main or release only.** (session-settled: user-directed — chosen over local or per-PR mutation runs.) Governs R16, R17.

### Requirements

**Import scope**

- R1. The repository holds `@systemfsoftware/api-extractor` from #552 at `3a135a19`, added in a normal commit with no imported history and nothing from #462.
- R2. Only the package and the documents in R21 come across. The monorepo wiring in #552's diff (`pnpm-lock.yaml`, `dprint.json`, `CONCEPTS.md`, `.github/workflows/reusable-smoke.yml`, `.changeset/*`) stays behind.
- R3. The package keeps #552's behavior and public surface. It changes only where it must compile and pass against the dependency versions at the pinned flake revisions, because those are newer majors than #552 was written against.

**Dependency sourcing**

- R4. Every `@systemfsoftware/*` dependency installs from `.sfs-deps` tarballs that a flake pinned in `flake.lock` produces. Monorepo packages come through systemfsoftware's `lib.mkConsumerStore`. Stryker packages come from stryker-js-effect's `workspace-tarballs`. The pnpm lockfile records them as `file:` entries.
- R5. `package.json` declares `@systemfsoftware/*` dependencies by semver range, and `pnpm-workspace.yaml` overrides map them to the tarballs. The packed manifest therefore carries no `file:` or `workspace:` specifier.
- R6. `@systemfsoftware/tsdown-config`, `@systemfsoftware/vitest-config` and `@systemfsoftware/stryker-config` come from a family flake the same way as R4, or the work reports them as blocked.
- R7. `@systemfsoftware/stryker-test-contribution` comes from a family flake the same way as R4, or the work reports it as blocked.

**CI on the PR head**

- R8. One PR into `main` exists, and CI on its head passes build, lint, typecheck and tests on standard hosted Linux runners.
- R9. A differential lane compares the engine with `@microsoft/api-extractor` 7.59.1 and fails on any byte difference in API reports, `.d.ts` rollups or `tsdoc-metadata.json`.
- R10. #552's packed-tarball CLI journey packs this package, installs the tarball into a scratch project, and passes. The runtime `@systemfsoftware/effect-cell-types` in that install comes from its pinned tarball, not from the registry.
- R11. gritlint conventions run in CI from the systemfsoftware flake's gritlint package. No binary is committed and none is installed from npm.
- R12. If the type-resolution check stays in the gates, it runs from the are-the-types-wrong-effect flake's `attw` package, and `@systemfsoftware/arethetypeswrong-cli` leaves `devDependencies`.

**Repository identity and knowledge**

- R13. `package.json` `repository`, `homepage` and `bugs` point at systemfsoftware/api-extractor-effect.
- R14. `.compound-engineering/config.yaml` declares the cell-architecture, boundary-testing, schema-laws and package-topology packs. The source is the `https://github.com/systemfsoftware/systemfsoftware` git repository, path `compound-packs`, with `ref` set to a full systemfsoftware `main` commit SHA. No `compound-packs/` directory exists here.

**Release and mutation**

- R15. Changeset intents drive versioning. A thin caller of systemfsoftware/pnpm-release-management's reusable `release.yml` cuts GitHub Releases. Nothing publishes to npm, and no workflow uses repository secrets or environments.
- R16. Mutation testing runs only in a workflow triggered from `main` or a release, plus manual dispatch. It never runs on `pull_request` or locally, and it uses the shared stryker config.
- R17. A `workflow_dispatch` run of the mutation workflow on the PR branch completes. Its publish steps are guarded to `main` and skip on that run.

**License and provenance**

- R18. `LICENSE` is MIT. It keeps the System F Software copyright and adds Microsoft's MIT copyright notice for the code ported from microsoft/rushstack `apps/api-extractor` 7.59.1 at `bc4cd29cc4984cef267437565bf681582948285e`.
- R19. `package.json` `license` is `MIT`.
- R20. The README states that provenance (upstream package, version, commit, license) and makes no Apache-2.0 claim.

**Carried documents**

- R21. #552's `docs/solutions/build-errors/inferred-composed-cell-type-makes-api-report-nondeterministic.md`, `docs/solutions/build-errors/self-host-dogfood-self-dependency.md`, `docs/solutions/design-patterns/straight-line-cell-shells-split-effect-choices-from-value-choices.md` and `docs/plans/2026-09-25-1815-feat-api-extractor-restart-plan.md` exist here at the same paths.

### Scope Boundaries

- Switching systemfsoftware's consumers to this package.
- Copying any monorepo toolchain file or package: tsconfig bases, vitest or oxlint presets, scripts, `compound-packs/`, or workflows other than thin callers of shared reusable ones.
- Repo-local helper scripts written to produce evidence.
- Third-party executable dependencies not already in #552's `package.json`. `turbo` is one: #552's `smoke` script and systemfsoftware's `reusable-checks.yml` both call it, and #552's package does not declare it.
- References to private repositories, self-hosted runners, GitHub secrets or environments.
- Reshaping #552's test suite. Its CLI journey declares 22 journeys, which exceeds the 2–4 journey cap that test-layer selection sets for e2e. Trimming it is a package-design change, so it stays with #552's design and is not part of this unit.

### Load-Bearing Premises

Each row was checked in this session. Cross-repo paths read `repo@rev:path:line`. "nix eval" rows were checked by evaluating the flake at that revision.

| Premise | Source | Status |
|---|---|---|
| `tsdown-config`, `vitest-config` and `stryker-config` are `"private": true` in systemfsoftware main | `systemfsoftware@cf6ab028e5:packages/toolchain/{tsdown-config,vitest-config,stryker-config}/package.json:3` | Confirmed |
| `mkPnpmWorkspacePackages` drops private members, and `mkConsumerStore` throws for a name outside the public set | `pnpm-release-management@bc3b9b3:nix/lib/pnpm-workspace-packages.nix:53,90,121`; `systemfsoftware@cf6ab028e5:flake.nix:58-67` (throw at :64) | Confirmed; nix eval of `workspace-tarballs.members` at cf6ab028e5 lists the 9 other needed packages and none of the 3 toolchain packages |
| stryker-js-effect's same-named toolchain packages are also private, so no family flake ships them | `stryker-js-effect@1e1de6d:packages/toolchain/{stryker-config,tsdown-config,vitest-config}/package.json` (`private: true`) | Confirmed; nix eval of its `workspace-tarballs.members` omits them |
| Stryker packages are released by stryker-js-effect's `packages.<system>.workspace-tarballs`; that flake has no `lib` output | `stryker-js-effect@1e1de6d:flake.nix:48-64,96`; nix eval of `#lib` fails | Confirmed; consumers assemble the store the way its own `publishedOf` does (`flake.nix:48-56`) |
| `@systemfsoftware/stryker-test-contribution`, which #552's mutation config loads as a plugin, is absent from stryker-js-effect HEAD and from its release set | #552 `packages/api-extractor/stryker.config.ts` (`plugins`); `stryker-js-effect@1e1de6d:.changeset/ledger.yaml:683-701` (released up to 4.1.0 from `packages/stryker-test-contribution`); that directory is gone; nix eval lists 17 members without it | Confirmed; new premise |
| are-the-types-wrong-effect's flake exposes an `attw` binary and no workspace tarballs | `are-the-types-wrong-effect@171583c:flake.nix:24-31`, `nix/attw.nix`; nix eval: `attw`, `comment-checker`, `comment-checker-bwrap`, `default`, `dprint`; `attw.name` = `attw-4.2.0` | Confirmed |
| #552 resolves `arethetypeswrong-cli` and every stryker package from the npm registry | #552 `pnpm-workspace.yaml` catalogs (`stryker: latest`); #552 `pnpm-lock.yaml:5716-5770` (registry integrity) | Confirmed |
| #552 was written against older majors than any `mkConsumerStore`-capable systemfsoftware revision ships | merge-base `b6b294f9` (2026-09-26), 97 commits behind main, has no `mkConsumerStore`; the first revision that has it is `217c80d5` (2026-10-06). Across that span: effect-cell-types 10.3.0→12.0.0, differential-spec 0.6.0→1.0.1, effect-gherkin-spec 6.0.0→7.0.1, effect-memfs 5.0.0→6.0.0, effect-schema-law 4.0.0→5.0.1, effect-schema-vite 2.2.6→3.0.1, oxlint-config-recommended 3.2.0→4.0.0, vitest 0.2.0→2.0.0; `effect` 4.0.0-rc.117→^4.0.1 | Confirmed; governs R3 |
| #552's CLI journey installs `workspace:` siblings packed from the checkout, so it relies on a workspace this repository lacks | #552 `packages/api-extractor/examples/cli-journey.ts:224-273`; #552 `package.json` (`effect-cell-types: workspace:^`) | Confirmed; governs R5, R10 |
| #552's tests reach nothing outside the package | `git grep` over `src`, `tests`, `examples` finds one `../../../`, which resolves to the package root (`tests/__fixtures__/parity/parity-harness.fixture.ts:17`) | Confirmed |
| gritlint ships as `gritlint` (bwrap sandbox) and `gritlint-unwrapped`; stryker-js-effect uses the unwrapped one because hosted Ubuntu 24.04 refuses unprivileged user namespaces | `systemfsoftware@cf6ab028e5:flake.nix:82-113`; `stryker-js-effect@1e1de6d:flake.nix:84-87`, `gritlint.json:1-16`, `bin/gritlint` | Confirmed |
| The reusable release workflow requires `ci-workflow`, builds `.#workspace-tarballs` from the caller's flake, runs its tools in `nix develop`, and uses only `github.token` | `pnpm-release-management@bc3b9b3:.github/workflows/release.yml` (`on.workflow_call.inputs`, :55-57, :63, :85, :91) | Confirmed |
| No shared reusable mutation workflow exists | `workflow_call` workflows: pnpm-release-management has `changeset-check.yml` and `release.yml`; systemfsoftware has `conflict-check.yml`, `reusable-checks.yml`, `reusable-smoke.yml`. Both `mutation.yml` files (systemfsoftware, 192 lines; stryker-js-effect, 352 lines) are repo-local | Confirmed |
| systemfsoftware's `reusable-checks.yml` needs a caller-supplied `.github/actions/checks-lane` action and runs `turbo` | `systemfsoftware@cf6ab028e5:.github/workflows/reusable-checks.yml:3-6,263` | Confirmed |
| A `workflow_dispatch` trigger fires only when the workflow file is on the default branch, and this repository's `main` holds only `11e027b Initial commit` (`LICENSE`) | GitHub Docs, "Manually running a workflow"; `git log` here | Confirmed; one documented workaround registers the workflow through another trigger, then dispatches with `gh workflow run --ref` |
| All four packs exist at systemfsoftware main, and the CE pack resolver accepts a git `source` with `ref`, `path` and `pack` | `systemfsoftware@cf6ab028e5:compound-packs/{boundary-testing,cell-architecture,package-topology,schema-laws}`; `.compound-engineering/config.yaml:1-5` there; stryker-js-effect's config uses unpinned `/tree/main` (`.compound-engineering/config.yaml:1-4`) | Confirmed |
| #552's package is Apache-2.0, and its README promises a third-party MIT notice that #552 does not add | #552 `packages/api-extractor/LICENSE:1-3`, `package.json` `license`, `README.md:5,94-96`; #552 file list has no notice file; the upstream commit is recorded in #552's plan at line 17 | Confirmed |
| This repository's `LICENSE` is MIT with only the System F Software copyright | `LICENSE:1-3` | Confirmed |
| Hosted runners can build systemfsoftware's full tarball set, and every consumer store copies out of that one derivation | `systemfsoftware@cf6ab028e5:.github/workflows/nix.yml:51-53`; `pnpm-workspace-packages.nix:124-129` | Confirmed; [INFERENCE] with no binary cache (no secrets), each CI run rebuilds every public monorepo package |

### Outstanding Questions

**Resolve Before Planning**

1. **Private toolchain packages (R6).** `tsdown-config`, `vitest-config` and `stryker-config` are private in both family repositories, so no pinned flake can supply them. Options: (a) block this unit until an upstream change publishes them, then pin that revision; (b) drop them from the dependency set and write this repository's own tsdown, vitest and stryker configuration, which removes R6 and the "shared stryker config" clause of R16; (c) stop and report blocked.
2. **`stryker-test-contribution` (R7).** It is missing from stryker-js-effect HEAD and from its release set. Options: (a) block until a family flake releases it again; (b) remove the plugin from the mutation config, so mutation runs no longer judge test contribution; (c) stop and report blocked.
3. **Workflow authorship (R8, R16).** No shared reusable mutation workflow exists. systemfsoftware's reusable checks workflow needs `turbo` and a repo-local composite action. Does "workflows other than thin callers" forbid only workflows copied from the monorepo, or every non-thin workflow authored here? If the second, a shared reusable CI or mutation workflow has to land in a family repository first.
4. **Dispatch proof (R17).** `main` here has no workflows, so `workflow_dispatch` cannot target the new mutation workflow while it lives only on the PR branch. Options: (a) register it once through a trigger that runs no mutation, dispatch it on the branch with `gh workflow run --ref`, then remove that trigger before the final head; (b) land the workflow on `main` first in a bottom stack layer, which breaks R8's single PR; (c) accept a different proof event.

**Deferred to Planning**

- Which systemfsoftware `main` SHA the flake and the packs `ref` pin to. It must be at or after `217c80d5`. The stryker-js-effect revision is chosen the same way.
- Whether R3's port across the major bumps finds any removed capability the package needs. Per the family-flake decision, such a gap is reported as blocked.
- How the CLI journey supplies the `effect-cell-types` tarball to its scratch install (R10).
- Whether the thin release caller pins pnpm-release-management by SHA or `@main`. The reusable workflow builds its tools at `job.workflow_sha`.
- Whether CI runs gritlint through `gritlint-unwrapped`, given the hosted-runner user-namespace limit.
- Whether the carried restart plan (R21) gets a note that its monorepo paths and the "34 configs across 30 packages" acceptance are historical.
- How CI avoids rebuilding systemfsoftware's whole tarball set on every run, given that no secrets are allowed for a binary cache.
