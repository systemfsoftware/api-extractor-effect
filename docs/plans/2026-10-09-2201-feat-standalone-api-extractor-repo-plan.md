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

- **Objective:** `@systemfsoftware/api-extractor` has its own public product repository. A consumer can take a released tarball of it from this repository's flake, and every change to it is checked against upstream `@microsoft/api-extractor` 7.59.1 before it lands. No piece of the build comes from the systemfsoftware monorepo's working tree or from the npm registry under the `@systemfsoftware` scope.
- **Means:** a fresh import of systemfsoftware/systemfsoftware PR #552 (`fork-api-extractor2`, head `3a135a19cbff4bbcd0396135e52a75f7f5996420`) as a one-member pnpm workspace (KTD1), with every `@systemfsoftware/*` package supplied as `.sfs-deps` tarballs by pinned family flakes (KTD2), landed as one PR into `main`.
- **Authority:** #552 settles the package's design. The Product Contract below settles the repository's shape. KTDs settle mechanism inside the Product Contract. A unit never overrides either.
- **Stop conditions:** stop and report blocked, never vendor or copy, when (a) a family flake at its pinned revision lacks a package or a capability the package needs (R3, R4), (b) a change needs a third-party executable dependency outside #552's `package.json` and install closure, or (c) the API report changes in a name the package itself declares (KTD9).
- **External prerequisite:** P1 in Risks & Dependencies. Every unit is authored now. The lockfile, CI green and the mutation dispatch proof wait on P1.
- **Execution profile:** sequential units on branch `feat/import-api-extractor`, one PR. Mutation never runs locally. Verification runs in this session's terminal and in GitHub Actions on the PR head.

---

## Product Contract

### Summary

Import #552's package into this repository as a self-contained product. It gets flake-sourced dependencies, its own CI, pinned knowledge packs, an MIT license with Microsoft's notice, and thin-caller release flows. The monorepo's toolchain is not copied. Where a family flake cannot supply a package, the work stops and reports it as blocked.

### Problem Frame

#552 built the package inside the systemfsoftware monorepo, where it resolves siblings through `workspace:` links, shares catalogs and toolchain presets, and runs under turbo. None of that exists in this repository. The family already distributes packages as Nix-built tarballs instead of a registry, so the package has to adopt that path to stand alone.

### Key Decisions

- **Fresh import in a normal commit.** History stays in the monorepo; this repository starts from #552's tree. (session-settled: user-directed — chosen over a `git filter-repo` history import: the user asked for a plain copy commit.) Governs R1.
- **#552 is the only source; #462 contributes nothing.** (session-settled: user-directed — chosen over taking anything from #462: #552 supersedes it.) Governs R1.
- **MIT, not #552's Apache-2.0.** (session-settled: user-directed — chosen over keeping #552's Apache-2.0 package license: the port is from MIT-licensed upstream code.) Governs R18, R19, R20.
- **Family flake tarballs or blocked; never the registry, never a vendored copy.** (session-settled: user-directed — chosen over vendoring or copying monorepo packages: a missing or deficient package is reported as blocked.) Governs R4, R5, R6.
- **The three private toolchain packages come from the systemfsoftware flake once it releases them.** The flake revision is pinned when that release exists. All other work proceeds now. (session-settled: user-directed — chosen over writing this repository's own tsdown, vitest and stryker configuration, and over stopping: copies and repo-local replacements are both excluded, and publishing them is upstream work the user is taking to the root.) Governs R6.
- **`stryker-test-contribution` is dropped.** Its owner deleted it on purpose in stryker-js-effect `1cf39f2` (#123, squashing "chore(repo): delete the test-contribution plugin"). (session-settled: user-directed — chosen over blocking until a family flake releases it again: the package is gone by design.) Governs R7.
- **Workflows authored for this repository are allowed; workflows copied from the monorepo are not.** CI and mutation are this repository's own workflows. Release and changeset check are thin callers of pnpm-release-management's reusable workflows. No `turbo`. (session-settled: user-directed — chosen over requiring a shared reusable CI or mutation workflow to land in a family repository first: the ban targets copies.) Governs R8, R11, R15, R16.
- **The dispatch proof uses a temporary trigger that runs no mutation.** (session-settled: user-directed — chosen over landing the workflow on `main` first in a stacked layer, which breaks the single PR, and over a different proof event.) Governs R17.
- **attw stays, from the are-the-types-wrong-effect flake binary.** (session-settled: user-approved — proposed with the alternative of dropping the step, which also meets R8–R10; the user accepted keeping it.) Governs R12.
- **Porting #552 to the dependency majors at the pinned revisions is in scope.** A capability missing at the pin stops the work as blocked. (session-settled: user-directed — chosen over pinning older family revisions: those predate `mkConsumerStore` and the toolchain release.) Governs R3.
- **The CLI journey installs this repository's packed tarball plus `.sfs-deps` tarballs.** It never installs from a monorepo workspace or the registry. (session-settled: user-directed — chosen over #552's packing of `workspace:` siblings, which needs a workspace this repository lacks.) Governs R10.
- **Knowledge packs come from a pinned git source, and all four apply.** The package composes Sandwich cells (cell-architecture), pins upstream semantics with a differential lane (boundary-testing), declares Effect schemas with laws (schema-laws), and publishes an exports map (package-topology). (session-settled: user-directed — chosen over a local `compound-packs/` copy and over stryker-js-effect's unpinned `/tree/main` URLs.) Governs R14.
- **No registry publishing; GitHub Releases only.** (session-settled: user-directed — chosen over npm publishing.) Governs R15.
- **Mutation testing runs on main or release only.** (session-settled: user-directed — chosen over local or per-PR mutation runs.) Governs R16, R17.

### Requirements

**Import scope**

- R1. The repository holds `@systemfsoftware/api-extractor` from #552 at `3a135a19`, added in a normal commit with no imported history and nothing from #462.
- R2. Only the package and the documents in R21 come across. The monorepo wiring in #552's diff (`pnpm-lock.yaml`, `dprint.json`, `CONCEPTS.md`, `.github/workflows/reusable-smoke.yml`, `.changeset/*`) stays behind.
- R3. The package keeps #552's behavior and public surface. It changes only where it must compile and pass against the dependency versions at the pinned flake revisions, because those are newer majors than #552 was written against.

**Dependency sourcing**

- R4. Every `@systemfsoftware/*` package in the install, direct or transitive, installs from `.sfs-deps` tarballs that a flake pinned in `flake.lock` produces. Monorepo packages come from the systemfsoftware flake. Stryker packages come from stryker-js-effect's `workspace-tarballs`. The pnpm lockfile records them as `file:` entries.
- R5. `package.json` declares `@systemfsoftware/*` dependencies by semver range, and `pnpm-workspace.yaml` overrides map them to the tarballs. The packed manifest therefore carries no `file:` or `workspace:` specifier.
- R6. `@systemfsoftware/tsdown-config`, `@systemfsoftware/vitest-config` and `@systemfsoftware/stryker-config` come from the systemfsoftware flake the same way as R4.
- R7. The mutation configuration and `devDependencies` no longer name `@systemfsoftware/stryker-test-contribution`.

**CI on the PR head**

- R8. One PR into `main` exists, and CI on its head passes build, lint, typecheck and tests on standard hosted Linux runners.
- R9. A differential lane compares the engine with `@microsoft/api-extractor` 7.59.1 and fails on any byte difference in API reports, `.d.ts` rollups or `tsdoc-metadata.json`.
- R10. #552's packed-tarball CLI journey packs this package, installs the tarball into a scratch project, and passes. Every `@systemfsoftware/*` package in that install comes from its pinned tarball, not from the registry.
- R11. gritlint conventions run in CI from the systemfsoftware flake's gritlint package. No binary is committed and none is installed from npm.
- R12. The type-resolution check runs in CI from the are-the-types-wrong-effect flake's `attw` package, and `@systemfsoftware/arethetypeswrong-cli` is not a dependency.

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
- Copying any monorepo toolchain file or package: tsconfig bases, vitest or oxlint presets, scripts, patches, `compound-packs/`, or workflows.
- Repo-local helper scripts written to produce evidence.
- Third-party executable dependencies not already in #552's `package.json` or install closure. `turbo` is one: #552's `smoke` script calls it, and #552's package does not declare it.
- References to private repositories, self-hosted runners, GitHub secrets or environments.
- Reshaping #552's test suite. Its CLI journey declares 22 journeys, which exceeds the 2–4 journey cap that test-layer selection sets for e2e. Trimming it is a package-design change, so it stays with #552's design.
- A formatter gate. Done does not name one, and adding dprint would need a `dprint.json`, which R2 leaves behind.

### Load-Bearing Premises

Each row was checked in this session. Cross-repo paths read `repo@rev:path:line`. "nix eval" rows were checked by evaluating the flake at that revision.

| Premise | Source | Status |
|---|---|---|
| `tsdown-config`, `vitest-config` and `stryker-config` are `"private": true` in systemfsoftware main | `systemfsoftware@cf6ab028e5:packages/toolchain/{tsdown-config,vitest-config,stryker-config}/package.json:3` | Confirmed |
| `mkPnpmWorkspacePackages` drops private members, and `mkConsumerStore` throws for a name outside the public set | `pnpm-release-management@bc3b9b3:nix/lib/pnpm-workspace-packages.nix:53`; `systemfsoftware@cf6ab028e5:flake.nix:58-67` (throw at :64) | Confirmed |
| The package's full `@systemfsoftware/*` closure is 24 packages. At cf6ab028e5, 21 are in the public tarball set and the 3 toolchain packages are not | manifests at `systemfsoftware@cf6ab028e5`; nix eval of `packages.x86_64-linux.workspace-tarballs.members` | Confirmed; the 21 are listed in KTD2 |
| `mkPnpmWorkspacePackages` reads members only from `pnpm-workspace.yaml` `packages:` globs; a root `package.json` is never a member | `pnpm-release-management@bc3b9b3:nix/lib/pnpm-workspace-packages.nix:18-53` | Confirmed; governs KTD1 |
| The reusable release workflow builds `.#workspace-tarballs` from the caller's flake, runs its tools in `nix develop`, needs `ci-workflow`, and uses only `github.token` | `pnpm-release-management@bc3b9b3:.github/workflows/release.yml:55-57,63`; README:291-292 (dev shell must provide pnpm, `sandbox`, `SANDBOX_PNPM_STORE`) | Confirmed |
| The changeset check needs `devshell: true` and a root `bootstrap` script when the lockfile names `file:.sfs-deps` tarballs | `pnpm-release-management@bc3b9b3:README.md:308-317` | Confirmed |
| Stryker packages are released by stryker-js-effect's `packages.<system>.workspace-tarballs`; that flake has no `lib` output | `stryker-js-effect@1e1de6d:flake.nix:48-64`; nix eval of `#lib` fails | Confirmed |
| stryker-js-effect `27b10759` is the `stryker-js@v18.1.0` release commit, the revision its own flake pins, and its 17 tarballs cover the package's 12-package stryker closure | tags `@systemfsoftware/stryker-js@v18.1.0`, `…-typescript-checker@v8.3.1`, `…-vitest-runner@v9.0.1` point at it; `stryker-js-effect@1e1de6d:flake.nix:37`; nix eval of its members | Confirmed |
| `stryker-test-contribution` was deleted on purpose | `stryker-js-effect@1cf39f2` (2026-09-26, #123) deletes `packages/stryker-test-contribution/package.json`; its body lists "chore(repo): delete the test-contribution plugin" | Confirmed. The SHA `5444464e2` cited for this does not resolve in a full clone; `1cf39f2` is the deleting commit |
| are-the-types-wrong-effect's flake exposes an `attw` binary and no workspace tarballs | `are-the-types-wrong-effect@171583c:flake.nix:24-31`, `nix/attw.nix`; nix eval: `attw.name` = `attw-4.2.0` | Confirmed |
| #552 resolves `arethetypeswrong-cli` and every stryker package from the npm registry | #552 `pnpm-workspace.yaml` catalogs (`stryker: latest`); #552 `pnpm-lock.yaml:5716-5770` | Confirmed |
| #552 was written against older majors than any `mkConsumerStore`-capable systemfsoftware revision ships | merge-base `b6b294f9` has no `mkConsumerStore`; first revision with it is `217c80d5`. Across that span effect-cell-types 10.3.0→12.0.0, differential-spec 0.6.0→1.0.1, effect-gherkin-spec 6.0.0→7.0.1, effect-memfs 5.0.0→6.0.0, effect-schema-law 4.0.0→5.0.1, effect-schema-vite 2.2.6→3.0.1, oxlint-config-recommended 3.2.0→4.0.0, vitest 0.2.0→2.0.0; `effect` 4.0.0-rc.117→^4.0.1 | Confirmed; governs R3 |
| Every name #552 imports from those packages still exists at cf6ab028e5 | export lists of `effect-cell-types` (`Cell`, `Sandwich`, `Workflow`), `differential-spec` (`Differential.compare`), `effect-gherkin-spec`, `effect-schema-vite` (`inlineSchemaTests`), `@systemfsoftware/vitest` (`it`) at main | Partly confirmed: names only, from a delegated read; behavior across the majors is checked by U5 |
| `oxlint-tsgolint` and `@effect/tsgo` are already in #552's install closure | `oxlint-config-recommended` 3.2.0 at `b6b294f9` declares both; #552 `pnpm-lock.yaml` resolves `oxlint 1.82.0(oxlint-tsgolint@7.0.2001)` for the package | Confirmed; not new executables |
| `effect` resolves to stable ^4.0.1 at main, and main's packages still use `Schema.TaggedError` | `systemfsoftware@cf6ab028e5:pnpm-workspace.yaml` catalog; 52 files under `packages/` use `Schema.TaggedError<` | Confirmed |
| #552's CLI journey packs `workspace:` siblings from the checkout | #552 `packages/api-extractor/examples/cli-journey.ts:224-256` | Confirmed; governs R10, KTD7 |
| #552's tests reach nothing outside the package | one `../../../`, which resolves to the package root (`tests/__fixtures__/parity/parity-harness.fixture.ts:17`) | Confirmed |
| #552's `tsdown.config.ts` uses only `quietBuild` from `tsdown-config`; `vitest.config.ts` uses `defineConfig` and `sharedConfig` from `vitest-config`; `stryker.config.ts` uses `shardMutate` and `sharedConfig` from `stryker-config` | #552 `packages/api-extractor/{tsdown,vitest,stryker}.config.ts:1` | Confirmed |
| gritlint ships as `gritlint` (bwrap sandbox) and `gritlint-unwrapped`; hosted Ubuntu 24.04 refuses unprivileged user namespaces | `systemfsoftware@cf6ab028e5:flake.nix:82-113`; `stryker-js-effect@1e1de6d:flake.nix:84-87` | Confirmed |
| gritlint packs compile into the binary from systemfsoftware's `packs/` | `systemfsoftware@cf6ab028e5:nix/gritlint.nix:54-61` | Confirmed |
| systemfsoftware builds its full tarball set on a hosted runner inside a 60-minute job | `systemfsoftware@cf6ab028e5:.github/workflows/nix.yml:26-53` | Confirmed; [INFERENCE] with no binary cache, a cold run rebuilds it |
| A `workflow_dispatch` trigger fires only for a workflow on the default branch, and `main` here holds only `11e027b Initial commit` | GitHub Docs, "Manually running a workflow"; `git log` | Confirmed |
| All four packs exist at systemfsoftware main, and the CE resolver accepts a git `source` with `ref`, `path` and `pack` | `systemfsoftware@cf6ab028e5:compound-packs/*`; `ce-brainstorm/scripts/packs-resolve.py:79,515-542` | Confirmed |
| Upstream's notice is "Copyright (c) Microsoft Corporation. All rights reserved." under the MIT License, and `bc4cd29` is 7.59.1 | `microsoft/rushstack@bc4cd29:apps/api-extractor/LICENSE:1-3`, `package.json` `version` | Confirmed |
| #552's package is Apache-2.0, its README promises a third-party MIT notice #552 never adds, and its install instructions use the registry | #552 `packages/api-extractor/LICENSE:1-3`, `package.json` `license`, `README.md:5,8,22,94-96` | Confirmed |
| This repository's `LICENSE` is MIT with only the System F Software copyright | `LICENSE:1-3` | Confirmed |

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Keep the package at `packages/api-extractor/` under a private root workspace.** `mkPnpmWorkspacePackages` enumerates members only from `pnpm-workspace.yaml` `packages:` globs, so a root-level package would produce an empty `workspace-tarballs` and the reusable release workflow would have nothing to tag. The layout also keeps the package's `AGENTS.md` gate paths and fixture-relative paths valid unchanged. Governs R8, R15.
- KTD2. **One `.sfs-deps` directory, built by this repository's flake, holds every family tarball under its `<attr>-<version>.tgz` name.** Systemfsoftware tarballs are chosen by name from that flake's `workspace-tarballs.members`, the same lookup `lib.mkConsumerStore` performs, so a private or missing name fails evaluation exactly as `mkConsumerStore` does. The 21 public systemfsoftware names are `differential-spec`, `effect-cell-types`, `effect-gherkin-spec`, `effect-memfs`, `effect-schema-discovery`, `effect-schema-law`, `effect-schema-recursion-budget`, `effect-schema-vite`, `effect-sim-kernel`, `effect-spec-runtime`, the four `oxlint-config-*`, the five `oxlint-plugin-*`, `tsconfig` and `vitest`; R6 adds `tsdown-config`, `vitest-config` and `stryker-config` once P1 lands. Stryker tarballs come from stryker-js-effect's members the same way. The store is assembled by passing that directory as `files.".sfs-deps"` to `mkPnpmWorkspacePackages`, as stryker-js-effect does (`flake.nix:57-64`). `lib.mkConsumerStore` itself is not called: its single `files.${dir}` link farm carries only systemfsoftware members, while this lockfile also names stryker-js-effect tarballs in the same install. Governs R4, R6.
- KTD3. **Flake inputs and pins.** `systemfsoftware`: the revision that releases the three toolchain packages, pinned when it exists (P1); its nixpkgs is not followed, as in stryker-js-effect (`flake.nix:20-25`). `stryker-js-effect`: `27b1075905a6c69e74eff163567ac25dd4839a1b`. `are-the-types-wrong-effect`: `171583cc89d67b14b3125d6fd41c418239ed3e4f`. `pnpm-release-management`: `bc3b9b37bb899010dd16a0d6c4345ccc9a2c7c9b`. The pack `ref` is `cf6ab028e5e5f71b4d0971112a03ca8fd6024eae` now and moves to the P1 revision when that pin lands, so packs and flake describe one systemfsoftware state. Governs R4, R14.
- KTD4. **pnpm 12 from the locked nixpkgs, Node 24.** The root `packageManager` pins the exact `pnpm_12` version the locked nixpkgs provides, because `mkPnpmWorkspacePackages` fails evaluation on a mismatch (`pnpm-workspace-packages.nix:67-76`). CI's `pnpm/action-setup` reads the same pin.
- KTD5. **No catalogs; explicit ranges.** `catalog:` and `workspace:^` specifiers become explicit ranges: family packages by the version at the pinned revision (for example `@systemfsoftware/effect-cell-types: ^12.0.0`), third-party packages by systemfsoftware main's catalog (`effect` and `@effect/platform-node` `^4.0.1`, `vitest ^5`, `tsdown ^0.23.0`, `fast-check ^4`, `rimraf ^6.1.3`, `@types/node ^26`, `oxlint ~1.82.0`). `typescript 5.9.3` and `@microsoft/api-extractor 7.59.1` stay exact. One manifest has no reuse for a catalog to serve. Governs R5.
- KTD6. **The root manifest delegates; it adds no tooling.** The root `package.json` is private and carries `packageManager`, a `bootstrap` script (`pnpm install --frozen-lockfile`, which the changeset check runs) and scripts that forward to the package with `pnpm --filter`. #552's `smoke` script loses `turbo` and becomes build-then-journey; `turbo.json` is removed. Governs R8, scope boundary on `turbo`.
- KTD7. **The journey's scratch install inherits this repository's `@systemfsoftware/*` overrides with absolute paths.** It still packs this package itself, then writes the scratch `pnpm-workspace.yaml` overrides from the repository's own overrides, each `file:.sfs-deps/…` path made absolute. `pnpm-workspace.yaml` stays the single place that maps names to tarballs. The journey fails if the scratch lockfile resolves any `@systemfsoftware/*` package from the registry. Governs R10 (pack: boundary-testing, real-system-oracles.md).
- KTD8. **The upstream-parity lane runs as its own CI job.** It is the package's semantic pin on upstream (pack: boundary-testing, pin-dependency-semantics.md), so it reports separately from the other tests. It runs with #552's budgets unchanged. Governs R9.
- KTD9. **The API report gate decides R3.** `api:check` runs inside `build` against the committed `etc/api-extractor.api.md`. A report diff limited to how dependency types render is accepted through `api:update` and noted in the PR body. A diff in any name the package declares is a surface change (pack: package-topology, surface-changes-are-versioned.md) and is a stop condition. Governs R3.
- KTD10. **gritlint is this flake's `gritlint` output, which is systemfsoftware's `gritlint-unwrapped`.** CI runs it with `nix run .#gritlint -- check` and attw with `nix run .#attw`, not through `nix develop`: entering the dev shell realizes `.sfs-deps` and the pnpm store from the Nix store, which bypasses KTD11's cache and forces a cold build of both tarball sets. The dev shell still provides both tools for local work. `gritlint.json` enables `source-resolution`, `typecheck-build-mode` and `npm-provenance` with stryker-js-effect's parameters, except `repositoryUrl`, which names this repository. No `bin/` wrapper is added. Governs R11, R12.
- KTD11. **CI materializes `.sfs-deps` through one composite action** that restores it from `actions/cache`, keyed on the `flake.lock` nodes it depends on, and otherwise runs `nix build .#sfs-deps` and copies the tarballs in. stryker-js-effect's `released-tarballs` action has the same shape. Every job that installs uses it. Governs R4, R8.
- KTD12. **The workspace tarball is proven reproducible in CI.** A Nix job runs `nix build .#workspace-tarballs` and then `--rebuild`, as systemfsoftware's `nix.yml:49-53` does. Release tagging refuses a tarball whose bytes drift (pnpm-release-management README:404-408), so this check is what makes the package releasable. Governs R15.
- KTD13. **Release callers pin the reusable workflows by SHA.** `release.yml` and `changeset-check.yml` call `systemfsoftware/pnpm-release-management/.github/workflows/<file>@bc3b9b37bb899010dd16a0d6c4345ccc9a2c7c9b`, the same revision as the flake input. `release.jsonc` uses `versioning.strategy: changesets` and `gate.strategy: paths`, and `pnpm-workspace.yaml` sets `versioning.changelog.storage: repository`, as stryker-js-effect does. Governs R15.
- KTD14. **The mutation workflow is one job.** Its mutate set is `src/**/*.workflow.ts` through `stryker-config`'s `shardMutate` (pack: cell-architecture, pure-decision-workflows.md), small enough that sharding is not needed. Triggers are `push` to `main` with documentation paths ignored, plus `workflow_dispatch`. The report is uploaded as an artifact. Saving the incremental-results cache, its one publish step, runs only on `refs/heads/main`. Thresholds stay at #552's 100/100/100. Governs R16, R17.
- KTD15. **Dispatch proof sequence.** (session-settled: user-directed — chosen over a stacked bottom layer and over a different proof event: see Key Decisions.) Commit A adds the branch to the `push` trigger, with a job-level `if:` that skips every job on any push except to `main`. Pushing A registers the workflow and runs nothing. Then `gh workflow run mutation.yml --ref feat/import-api-extractor` runs it on the branch. Its run URL goes into the PR body. Commit B removes the branch trigger and the now-dead `if:`. Dispatch only after CI is green on the head it runs against. Governs R17.
- KTD16. **Carried documents are byte-identical to #552.** Their monorepo paths and acceptance counts are history, and an unchanged copy keeps R21 mechanically checkable. Governs R21.
- KTD17. **One license text in two places.** The root `LICENSE` and the package's `LICENSE` (which `files` ships) are the same MIT text: the System F Software copyright, then upstream's notice verbatim with the package name, version and commit it covers. Governs R18.
- KTD18. **No new committed tests.** The plan's proof is #552's own suites, the journey, and the CI and mutation runs. The journey's registry-resolution check is a runtime assertion inside an existing journey script, not a new test. Probes that prove a guard fails (U3, U6) are throwaway. test-layer-selection's admission gate refuses everything else this plan could add: each candidate would pin wiring or configuration rather than consumer-visible behavior.

### Assumptions

These bets were not confirmed in a dialogue; review them first.

- The P1 release keeps the toolchain packages' current export surfaces (`tsdown-config/quiet-build`, `vitest-config` `defineConfig`/`sharedConfig`, `stryker-config` `shardMutate`/`sharedConfig`). If it renames them, U4's config files follow the release, still without copying.
- A cold CI run that builds systemfsoftware's tarball set, the stryker-js-effect release chain and `gritlint-unwrapped` fits GitHub's 6-hour job limit. Warm runs restore `.sfs-deps` from cache.
- `oxlint-tsgolint` reaches the install as `oxlint-config-recommended`'s dependency without a top-level declaration. If pnpm's peer check demands a direct declaration, that is a stop-and-ask: it is in #552's install closure but not in its `package.json`.
- The root README carries the provenance statement plus a pointer to the package README, which stays the canonical usage document because it ships in the tarball.
- Root `AGENTS.md` is in scope because the imported package `AGENTS.md` says "Root `AGENTS.md` governs" and would otherwise point at nothing.

### High-Level Technical Design

*Directional, not an implementation specification.* Where tarballs come from and who consumes them:

```mermaid
flowchart LR
  subgraph pinned[flake.lock pins]
    SFS[systemfsoftware<br/>workspace-tarballs.members<br/>+ gritlint-unwrapped]
    SJE[stryker-js-effect 27b10759<br/>workspace-tarballs.members]
    ATTW[are-the-types-wrong-effect<br/>attw]
    PRM[pnpm-release-management<br/>mkPnpmWorkspacePackages,<br/>release-tools, sandbox]
  end
  SFS --> D[.#sfs-deps<br/>&lt;attr&gt;-&lt;version&gt;.tgz]
  SJE --> D
  D -->|composite action, cached| CI[CI jobs:<br/>pnpm install --frozen-lockfile]
  D -->|files.".sfs-deps"| WT[.#workspace-tarballs<br/>api-extractor-X.Y.Z.tgz]
  D -->|shellHook copy| DEV[dev shell]
  CI --> J[CLI journey scratch install<br/>own tarball + absolute overrides]
  WT --> REL[reusable release.yml<br/>plan / version / tag / GitHub Release]
  PRM --> WT
  PRM --> DEV
  ATTW --> DEV
  SFS --> DEV
```

CI jobs on `pull_request`, `push` to `main` and `workflow_dispatch` (the release workflow dispatches `ci.yml` on its release PR branch):

| Job | Runs | Covers |
|---|---|---|
| check | `lint`, `typecheck`, `build` (includes `api:check`), `attw` | R8, R12, KTD9 |
| test | vitest over everything except the upstream-parity file | R8 |
| differential | `tests/upstream-parity.differential.test.ts` | R9 |
| journey | `smoke` (build, then `examples/cli-journey.ts`) | R10 |
| conventions | `nix run .#gritlint -- check`; the lockfile has no registry `@systemfsoftware/*` entry | R4, R11 |
| nix | `nix build .#workspace-tarballs`, then `--rebuild` | KTD12 |

### Output Structure

```text
.
├── .changeset/                      # new intent for the first release
├── .compound-engineering/config.yaml
├── .github/
│   ├── actions/sfs-deps/action.yml
│   └── workflows/{ci,mutation,release,changeset-check}.yml
├── .gitignore
├── AGENTS.md
├── LICENSE
├── README.md
├── docs/
│   ├── plans/2026-09-25-1815-feat-api-extractor-restart-plan.md
│   └── solutions/{build-errors,design-patterns}/…   # three carried entries
├── flake.nix, flake.lock
├── gritlint.json
├── package.json                     # private root
├── packages/api-extractor/          # #552's package tree, minus turbo.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── release.jsonc
```

### Risks & Dependencies

- **P1 (external, blocking DoD).** systemfsoftware must release `tsdown-config`, `vitest-config` and `stryker-config` as public workspace members. Until then `.sfs-deps` cannot hold them, `pnpm install` cannot produce the lockfile, and nothing that builds or tests can run. Owner: the user, at the root. Recovery: pin `systemfsoftware` and the pack `ref` to that revision (KTD3), regenerate the lockfile, continue at U4 verification.
- **Cold-build cost.** `systemfsoftware` `workspace-tarballs` builds the whole monorepo workspace. stryker-js-effect's `workspace-tarballs` installs from its own `stryker-published` input, so a cold build walks its release chain. `gritlint-unwrapped` is a Rust build. KTD11's cache covers `.sfs-deps` for this repository's CI. The `gritlint` build is not cached and runs once per cold conventions job. The reusable changeset check runs `bootstrap` inside `nix develop`, outside that cache, so each of its runs pays the cold build; stryker-js-effect carries the same cost.
- **Effect rc→stable port.** #552 targets `effect` 4.0.0-rc.117 (patched at `Queue`); the family now peers `effect ^4`. The size of the source port is unknown until U5 compiles it.
- **Reproducibility.** TypeScript 7 orders inferred unions nondeterministically (pnpm-release-management README:358-362); #552's solution entry `inferred-composed-cell-type-makes-api-report-nondeterministic.md` covers the same failure for the API report. KTD12 catches it; the fix is a named type annotation, not a retry.
- **Mutation at 100%.** `break: 100` fails the dispatch run if any mutant in `*.workflow.ts` survives against the pinned majors. A survivor is fixed by a test, never by lowering thresholds or excluding mutants.
- **GitHub access.** In this session `gh auth status` reported the stored token invalid and the REST API rate-limited. Pushing, opening the PR, reading CI and dispatching need working credentials.
- **Dispatch refusal.** GitHub documents `workflow_dispatch` for default-branch workflows only. KTD15 relies on the documented workaround that a workflow first registered by a branch push can be dispatched with `--ref`. If GitHub refuses the dispatch, stop and report; do not fall back to a stacked layer.
- **Release PR creation** needs the repository setting that lets GitHub Actions create pull requests. [INFERENCE] It is a repository setting, not a secret; it is outside Done until the first release cycle.

### Sources

- Release and CI shape: `pnpm-release-management@bc3b9b3:.github/workflows/{release,changeset-check}.yml`, `README.md:291-395`; `stryker-js-effect@1e1de6d:.github/{actions/released-tarballs/action.yml,workflows/{ci,mutation,release,changeset-check}.yml}`, `flake.nix:45-132`, `gritlint.json`, `pnpm-workspace.yaml:80-101`.
- Consumer store and tarball naming: `systemfsoftware@cf6ab028e5:flake.nix:46-71`, `nix/consumer-store-check.nix:5-61`.
- Upstream: `microsoft/rushstack@bc4cd29:apps/api-extractor/{LICENSE,package.json}`.

---

## Implementation Units

| U-ID | Title | Files touched | Depends on |
|---|---|---|---|
| U1 | Import #552's package and carried documents | `packages/api-extractor/**`, `docs/**` | — |
| U2 | License, provenance and repository identity | `LICENSE`, `README.md`, `AGENTS.md`, `packages/api-extractor/{LICENSE,README.md,package.json}` | U1 |
| U3 | Flake | `flake.nix`, `flake.lock`, `.gitignore` | — |
| U4 | Workspace manifests and lockfile | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/api-extractor/{package.json,turbo.json,stryker.config.ts}` | U1, U3, P1 |
| U5 | Port to the pinned dependency majors | `packages/api-extractor/{src,tests,examples}/**`, `etc/api-extractor.api.md` | U4 |
| U6 | CLI journey from `.sfs-deps` | `packages/api-extractor/examples/cli-journey.ts` | U4 |
| U7 | Conventions and knowledge packs | `gritlint.json`, `.compound-engineering/config.yaml` | U3, U4 |
| U8 | CI workflow | `.github/actions/sfs-deps/action.yml`, `.github/workflows/ci.yml` | U3–U7 |
| U9 | Release flow | `.github/workflows/{release,changeset-check}.yml`, `release.jsonc`, `.changeset/*` | U3, U4, U8 |
| U10 | Mutation workflow and dispatch proof | `.github/workflows/mutation.yml` | U8 |

### U1. Import #552's package and carried documents

- **Goal:** the repository holds #552's package tree and the four carried documents, byte-identical, in one commit.
- **Requirements:** R1, R2, R21; KTD1, KTD16.
- **Files:** `packages/api-extractor/**` from `3a135a19`; `docs/solutions/build-errors/inferred-composed-cell-type-makes-api-report-nondeterministic.md`, `docs/solutions/build-errors/self-host-dogfood-self-dependency.md`, `docs/solutions/design-patterns/straight-line-cell-shells-split-effect-choices-from-value-choices.md`, `docs/plans/2026-09-25-1815-feat-api-extractor-restart-plan.md`.
- **Approach:** export each path from `git -C <monorepo> show origin/fork-api-extractor2:<path>` (or `git archive` of that tree) without checking out. Nothing else from #552's diff. The commit is a pure copy, so every later adaptation shows as its own diff.
- **Test expectation:** none — a verbatim copy.
- **Verification:** the file list under `packages/api-extractor/` equals `git ls-tree -r --name-only 3a135a19 packages/api-extractor/`, and every copied blob hashes to the #552 blob (`git hash-object` against `git rev-parse 3a135a19:<path>`).

### U2. License, provenance and repository identity

- **Goal:** the license, README and manifest identify this repository and the upstream code honestly.
- **Requirements:** R13, R18, R19, R20; KTD17.
- **Files:** `LICENSE`, `packages/api-extractor/LICENSE`, `packages/api-extractor/package.json` (`license`, `repository` with `directory: packages/api-extractor`, `homepage`, `bugs`), `packages/api-extractor/README.md`, `README.md`, `AGENTS.md`.
- **Approach:** both `LICENSE` files carry the MIT text with "Copyright (c) 2026 System F Software", then a section for `@microsoft/api-extractor` 7.59.1 (microsoft/rushstack `apps/api-extractor` at `bc4cd29cc4984cef267437565bf681582948285e`) with "Copyright (c) Microsoft Corporation. All rights reserved." and its MIT permission text. The package README's License section states MIT and the provenance; its install sections take the release from this repository's flake (a tarball pinned by `flake.lock`, depended on by `file:`) instead of `pnpm add` from a registry. The root README is short: what the package is, the provenance line, a link to the package README. Root `AGENTS.md` states this repository's rules the package `AGENTS.md` defers to: `.sfs-deps` set-up (`nix build .#sfs-deps` or the dev shell), no registry `@systemfsoftware/*` resolution, no mutation runs locally, and the gate commands from the Verification Contract.
- **Test expectation:** none — documents and metadata.
- **Verification:** no file outside `docs/plans` and `docs/solutions` contains `Apache`; `package.json` `license` is `MIT`; the README names `7.59.1`, `bc4cd29` and MIT; `package.json` `repository.url` is `git+https://github.com/systemfsoftware/api-extractor-effect.git`.

### U3. Flake

- **Goal:** one flake provides the `.sfs-deps` set, the release-buildable workspace tarball and the dev shell every tool runs from.
- **Requirements:** R4, R6, R11, R12, R15; KTD2, KTD3, KTD4, KTD10.
- **Files:** `flake.nix`, `flake.lock`, `.gitignore` (`node_modules`, `dist`, `.sfs-deps`, `temp`, `reports`, `.stryker-tmp`).
- **Approach:** inputs per KTD3. Outputs per system (`x86_64-linux`, `aarch64-linux`): `sfs-deps` (KTD2's link farm), the `mkPnpmWorkspacePackages` set built with `files.".sfs-deps" = sfs-deps` and `pnpm = pkgs.pnpm_12` (which yields `workspace-tarballs`, the per-package tarball and `pnpm-store`), `gritlint` as systemfsoftware's `gritlint-unwrapped`, `attw` from are-the-types-wrong-effect. `devShells.default` provides `nodejs_24`, `pnpm_12`, `gritlint`, `attw`, pnpm-release-management's `release-tools` and `sandbox`, sets `SANDBOX_PNPM_STORE` to the `pnpm-store`, and its `shellHook` copies `sfs-deps` into `.sfs-deps/` as writable files, as stryker-js-effect's does (`flake.nix:122-130`). Until P1 the `sfs-deps` name list omits the three toolchain packages; adding them is part of the P1 pin bump.
- **Test expectation:** none — build configuration; U8's jobs exercise it.
- **Verification:** `nix flake check --no-build` evaluates; `nix build .#sfs-deps` lists one `<attr>-<version>.tgz` per chosen name; temporarily adding the name `tsdown-config` against cf6ab028e5 fails evaluation with `no public workspace package named tsdown-config`-style output (proves the guard, then revert).

### U4. Workspace manifests and lockfile

- **Goal:** `pnpm install --frozen-lockfile` resolves every `@systemfsoftware/*` package from `.sfs-deps`, and nothing in the manifests needs a monorepo.
- **Requirements:** R4, R5, R6, R7, R12; KTD1, KTD4, KTD5, KTD6.
- **Dependencies:** U1, U3, and P1 for the lockfile.
- **Files:** `package.json` (root), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/api-extractor/package.json`, `packages/api-extractor/turbo.json` (removed), `packages/api-extractor/stryker.config.ts`.
- **Approach:** `pnpm-workspace.yaml` has `packages: [packages/*]`, one override per `@systemfsoftware/*` name in the install closure (`"@systemfsoftware/<name>@*": file:.sfs-deps/<attr>-<version>.tgz`), `versioning.changelog.storage: repository`, and the build-script allowlist pnpm needs. Package specifiers follow KTD5. Remove `@systemfsoftware/arethetypeswrong-cli` and `@systemfsoftware/stryker-test-contribution` from `devDependencies` and the `plugins` entry from `stryker.config.ts`. Rewrite `smoke` without `turbo` (KTD6); keep `attw` as `attw --pack .`, now satisfied by the dev shell's binary. Add root scripts that forward with `--filter @systemfsoftware/api-extractor`, plus `test:differential` and the non-differential `test` split CI needs (KTD8). Generate the lockfile only after P1, inside the dev shell.
- **Test expectation:** none — manifests; the package's own suites run in U5.
- **Verification:** `pnpm install --frozen-lockfile` succeeds; `! git grep -nE "^  '@systemfsoftware/[a-z0-9-]+@[0-9]" -- pnpm-lock.yaml` exits 0; `git grep -n -e 'workspace:' -e 'catalog:' -e stryker-test-contribution -e arethetypeswrong-cli -e turbo -- package.json packages/api-extractor/package.json packages/api-extractor/stryker.config.ts` prints nothing; `pnpm pack` in the package produces a manifest whose `@systemfsoftware/*` specifiers are all semver ranges.

### U5. Port to the pinned dependency majors

- **Goal:** the package builds, typechecks, lints and passes its own suites against the pinned versions, with its public surface unchanged.
- **Requirements:** R3, R8, R9; KTD9.
- **Dependencies:** U4.
- **Files:** whatever under `packages/api-extractor/{src,tests,examples}` the compiler, linter and suites name; `packages/api-extractor/etc/api-extractor.api.md` only under KTD9's rule.
- **Approach:** run `typecheck`, `lint`, `build` and the suites; fix only what they report. Expected sources: `effect` rc.117→^4.0.1, `oxlint-config-recommended` 4's added `oxlint-config-rule-authoring` rules, `@systemfsoftware/vitest` 2.0.0 (property failures become tagged errors and failing seeds persist to `__property_seeds__/`). Keep the cell shapes the packs require: `Workflow.make` decisions, `Sandwich.named` phase order, the single `Extractor` namespace barrel (pack: cell-architecture, pure-decision-workflows.md, sandwich-phase-order.md, single-namespace-barrel.md). A schema law that fails after the bump is fixed in the codec (pack: schema-laws, law-failure-is-a-codec-defect.md). A name #552 imports that is gone at the pin is a stop condition (Goal Capsule).
- **Execution note:** characterization first. Run the unchanged suites against the new versions before editing anything, and keep that failure list as the work list.
- **Test scenarios:**
  - The 11 `*.workflow.property.test.ts` files pass under `@systemfsoftware/vitest` 2.0.0 with no new committed seed files beyond those a real failure would write.
  - `src/schema-laws.test.ts`, generated by `effect-schema-vite` 3, passes round-trip and encode-stability laws for every exported schema.
  - `tests/config-fixtures.integration.test.ts`, `extractor-flow.integration.test.ts`, `namespace-rollup.integration.test.ts` and `typescript-internals.contract.test.ts` pass on `effect-gherkin-spec` 7.
  - `tests/upstream-parity.differential.test.ts` passes every corpus fixture, the bare-extends and bundled-packages packages, and the generated-package property at `runBudget: 50`.
  - `build` passes `api:check` against the committed report with `ae-forgotten-export` still at `error` (pack: package-topology, public-signature-types.md).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test`, `pnpm run test:differential` exit 0; `packages/api-extractor/AGENTS.md` gate commands AE-R1 and AE-R2 print nothing.

### U6. CLI journey from `.sfs-deps`

- **Goal:** the packed-tarball journey installs the package and its family runtime dependencies only from tarballs this checkout holds.
- **Requirements:** R10; KTD7.
- **Dependencies:** U4.
- **Files:** `packages/api-extractor/examples/cli-journey.ts`.
- **Approach:** replace the `workspace:` sibling packing in `installedBinaryOf` with KTD7's override inheritance: read the repository root's `pnpm-workspace.yaml` overrides through a schema, keep the `@systemfsoftware/*` entries, absolutize each `file:` path against the repository root, and write them as the scratch overrides. After `pnpm add`, decode the scratch `pnpm-lock.yaml` and fail with a typed error naming any `@systemfsoftware/*` package resolved from the registry. Declared journey count stays 22. Scratch work stays under real temporary directories with real child processes (pack: boundary-testing, real-system-oracles.md).
- **Test scenarios:**
  - With `.sfs-deps` present, all 22 journeys run and the script exits 0.
  - The installed `@systemfsoftware/effect-cell-types` in the scratch project carries the integrity of `.sfs-deps/effect-cell-types-12.0.0.tgz`.
  - With `.sfs-deps` empty, the install fails and the script exits non-zero with the install error. That is a journey failure, not a skip.
  - With one override removed from a temporary copy of the overrides, the registry-resolution check fails naming that package. Run this as a throwaway probe, not a committed test.
- **Verification:** `pnpm run smoke` exits 0 and logs `ran 22 of 22`.

### U7. Conventions and knowledge packs

- **Goal:** gritlint conventions and the four knowledge packs are declared and resolve from pinned sources.
- **Requirements:** R11, R14; KTD3, KTD10.
- **Files:** `gritlint.json`, `.compound-engineering/config.yaml`.
- **Approach:** `gritlint.json` per KTD10, ignoring `**/__fixtures__/**`. `.compound-engineering/config.yaml` has one `packs` entry: `source: https://github.com/systemfsoftware/systemfsoftware.git`, `ref: cf6ab028e5e5f71b4d0971112a03ca8fd6024eae`, `path: compound-packs`, `pack: [cell-architecture, boundary-testing, schema-laws, package-topology]`.
- **Test expectation:** none — configuration.
- **Verification:** `nix run .#gritlint -- check` exits 0; the CE pack resolver (`ce-brainstorm/scripts/packs-resolve.py`, run from the repository root) returns four roots, no errors and no warnings; `git grep -n '/tree/main' -- .compound-engineering` prints nothing; no `compound-packs/` directory exists.

### U8. CI workflow

- **Goal:** CI on every PR head proves build, lint, typecheck, tests, upstream parity, the packed journey, conventions and reproducible tarballs.
- **Requirements:** R4, R8, R9, R10, R11, R12; KTD8, KTD11, KTD12.
- **Dependencies:** U3–U7.
- **Files:** `.github/actions/sfs-deps/action.yml`, `.github/workflows/ci.yml`.
- **Approach:** jobs per the High-Level Technical Design table on `ubuntu-latest`. Triggers: `pull_request`, `push` to `main`, `workflow_dispatch` (KTD13's release flow dispatches it). `permissions: contents: read`; concurrency cancels superseded non-`main` runs. Each installing job uses the composite action, then `pnpm/action-setup` and `actions/setup-node` (Node 24), then `pnpm install --frozen-lockfile`. `gritlint` and `attw` run through `nix run` per KTD10. Pin third-party actions to the majors stryker-js-effect uses (`actions/checkout@v7`, `cachix/install-nix-action@v31`, `actions/cache@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v7`). No secrets, no environments.
- **Test expectation:** none — workflow configuration; its runs are the evidence.
- **Verification:** the CI run on the PR head is green in every job; the `differential` and `journey` job logs show their test names and `ran 22 of 22`.

### U9. Release flow

- **Goal:** merging changeset intents to `main` cuts GitHub Releases through pnpm-release-management, with no registry publish.
- **Requirements:** R15; KTD12, KTD13.
- **Dependencies:** U3, U4, U8.
- **Files:** `.github/workflows/release.yml`, `.github/workflows/changeset-check.yml`, `release.jsonc`, `.changeset/<stem>.md`.
- **Approach:** `release.yml` runs on `push` to `main`, grants `actions: write`, `contents: write` and `pull-requests: write`, and only calls the reusable workflow with `ci-workflow: ci.yml`. `changeset-check.yml` runs on `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`), grants `contents: read` and `pull-requests: read`, and calls the reusable check with `devshell: true`. `release.jsonc` per KTD13 with `base: main`, `branch: changeset-release/main`, `changesetDir: .changeset`. A new intent marks `@systemfsoftware/api-extractor` `minor` with a consumer-facing description of the package (pack: package-topology, surface-changes-are-versioned.md).
- **Test expectation:** none — thin callers.
- **Verification:** the changeset-check run on the PR head is green; the CI `nix` job builds `.#workspace-tarballs` with `api-extractor-0.0.0.tgz` in `index.json`; `git grep -n -e 'npm publish' -e 'secrets\.' -e 'environment:' -- .github` prints nothing.

### U10. Mutation workflow and dispatch proof

- **Goal:** mutation testing runs on `main` and on demand with the shared stryker config, proven by one dispatched run on the PR branch.
- **Requirements:** R16, R17; KTD14, KTD15.
- **Dependencies:** U8; CI green on the head the dispatch runs against.
- **Files:** `.github/workflows/mutation.yml`.
- **Approach:** KTD14's single job: composite action, install, build, `pnpm --filter @systemfsoftware/api-extractor mutation`, upload `reports/mutation`, save the incremental cache under `if: github.ref == 'refs/heads/main'`. Then KTD15's two commits around one `gh workflow run … --ref feat/import-api-extractor`.
- **Test expectation:** none — workflow configuration; the dispatched run is the evidence.
- **Verification:** the dispatched run is green, its log shows the stryker run over `src/**/*.workflow.ts`, and its cache-save step shows as skipped; the final head's `mutation.yml` has no `pull_request` trigger and no branch other than `main` under `push`; the run URL is in the PR body.

---

## Verification Contract

Run in this order on the PR head; record the commands and exit codes in the PR body.

| Gate | Command or evidence | Proves |
|---|---|---|
| Copy fidelity | blob-hash comparison from U1 for the package tree and the four documents | R1, R21 |
| Flake | `nix flake check --no-build`; `nix build .#sfs-deps`; `nix build .#workspace-tarballs && nix build --rebuild .#workspace-tarballs` | R4, R6, KTD12 |
| No registry family packages | `! git grep -nE "^  '@systemfsoftware/[a-z0-9-]+@[0-9]" -- pnpm-lock.yaml` | R4 |
| Packed manifest | `tar -xOzf <api-extractor tarball> package/package.json`: every `@systemfsoftware/*` specifier is a semver range | R5 |
| Package gates | `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` (with `api:check`), `pnpm run test`, `pnpm run test:differential`, `pnpm run smoke` | R3, R8, R9, R10 |
| Flake tools | `nix run .#gritlint -- check`; `attw --pack .` in `packages/api-extractor` through `nix run .#attw` | R11, R12 |
| Packs | `packs-resolve.py`: 4 roots, 0 errors, 0 warnings | R14 |
| Removed names | `git grep -nI -e stryker-test-contribution -e arethetypeswrong-cli -e turbo -- . ':!pnpm-lock.yaml' ':!docs/'` prints nothing | R7, R12, KTD6 |
| License | both `LICENSE` files contain the System F and Microsoft notices; `git grep -n Apache -- . ':!docs/'` prints nothing | R18–R20 |
| CI | the `ci.yml` run on the PR head is green; so is the `changeset-check.yml` run | R8–R12, R15 |
| Mutation proof | the dispatched `mutation.yml` run URL, green, with the cache-save step skipped | R16, R17 |

## Definition of Done

- Every gate in the Verification Contract passed on the PR head, and the PR body records the commands, exit codes and run URLs.
- `flake.lock` pins systemfsoftware at the P1 release revision, and the pack `ref` names the same revision.
- The PR is the only PR into `main` for this work, and its head carries no temporary trigger from KTD15.
- No file from the Scope Boundaries' excluded list is in the diff: no copied toolchain file, monorepo workflow, patch, helper script or `compound-packs/` directory.
- No dead code from abandoned approaches remains in the diff: no unused scripts, overrides, flake outputs or workflow steps.
- Per unit: each unit's Verification passes on the final head, not only at the commit that introduced it.

### Open Questions

**Deferred to implementation**

- The exact source edits the effect rc.117→^4.0.1 port needs (U5). They are known only once the compiler runs against the pinned versions.
- Whether `effect-memfs`, which no #552 source file imports, stays a `devDependency`. Keep it unless lint or the dependency check flags it as unused; removing it changes nothing at runtime.
- The `actions/cache` key set for `.sfs-deps` (KTD11): which `flake.lock` nodes and narHashes it hashes.
