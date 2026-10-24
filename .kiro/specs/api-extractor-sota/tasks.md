# api-extractor-sota: tasks

Each `- [ ]` block below is one unit of work and one pull request. Work the blocks in order; the **Depends
on** line names what must be merged first. Every block is self-contained: it states its files, steps and
acceptance, so an agent that cannot read the other spec files can still do it.

The spec documents (`requirements.md`, `design.md`, this file) are scrubbed of private references. They are
not committed to this public repository until the lead approves the tasks; a task's PR does not commit them
while they carry private material.

## Global rules for every unit

- **One PR, one unit.** Branch from `origin/main` in a fresh worktree; open the PR on `main`; no stacks, no
  other unit's branch. Squash-merge after the merge bar.
- **Review before the first push.** Run the local review on the final local head, fix P0/P1 findings locally,
  push once, open the PR as ready. Per-PR mutation never runs; mutation stays on `main`.
- **Public repository.** No private repository, package or product name, no person, no local absolute path in
  code, fixtures, tests, reports, filenames, comments or PR text. Use `@example/*`, `#internal/*`,
  `NamespaceA`, repository-relative paths. Run the private-reference scrub on every new document; its count
  must be 0. The scrub's token list is kept out of this document so the document itself passes it.
- **Effect-native and canonical.** Effect Schema at every wire boundary; pure decisions; every JSON output
  through `canonicalJson`; `Order.String` ordering; no `Intl`, `toLocale*`, `localeCompare`; one `mod.ts`
  barrel, no subpath exports.
- **Versions.** A model schema change bumps `API_MODEL_SCHEMA_VERSION`; a corpus change bumps `corpusVersion`;
  the report and change report carry their own versions and refuse a mismatch.
- **No new required check, branch-protection change or Mergify change.** New CI jobs run red on failure but
  are not required checks.
- **No private artifacts in the public tree.** The corpus job may read a public corpus; the private consumer's
  reports stay in its own CI. The tool never receives a private corpus checkout in this repository.
- **Dependencies.** No new runtime dependency beyond PR #7's set. `@microsoft/api-extractor` 7.59.4 and
  `@microsoft/api-extractor-model` are devDependencies of the benchmark and conformance apps only.
- **Spec files.** Read `requirements.md` and `design.md` when they are present; otherwise this block's
  acceptance is the authority.

## Delivery order

| Order | Unit | PR | Requirement milestone |
|---|---|---|---|
| 0 | U0 | PR #7 review and merge | prerequisite (K4) |
| 1 | U1 | Model v3, source index, manifest targets | first deliverable (G1) |
| 2 | U2 | Report schema, printer, renderer, `report` | first deliverable (G1) |
| 3 | U3 | Change report, importer index, `diff` | first deliverable (G1) |
| 4 | U4 | Reusable consumer workflow, comment, judge proof | G1, J-0 |
| 5 | U5 | Model v4: external re-exports and ambient declarations | G3, C-6 |
| 6 | U6 | Corpus job | G3, I-1 |
| 7 | U7 | `check-bump` | G5, B-4 |
| 8 | U8 | Benchmark and profile | G6, P-1 |
| 9 | U9 | TypeScript 7.1 adapter and conformance | P-3, P-4 |
| 10 | U10 | E2E determinism and the durable counterfactual | R-7, Q |

U1-U4 are the first deliverable and add no corpus job, benchmark or changeset check. U1 and U5 touch the
model schema and are serial with every unit that imports it. U2-U4 and U7 touch the CLI app and are serial.
U4 and U6-U8 touch the workflow file and are serial.

---

- [ ] **U0 — Review and merge PR #7**

**Depends on:** nothing. **Requirements:** K4. **Files:** none in this unit; PR #7 is the input.

**Steps**

1. Read PR #7 at its head (`3deadf9c` or the current head) and its plan's ruling log. The review is by a
   non-author and cites evidence: the diff, the tests, the profile, the three refusals.
2. Resolve every P0/P1 finding locally on the PR branch or refute it with evidence. Do not grow the PR with
   this spec's features.
3. Confirm CI is green on the exact head and merge.

**Acceptance (evidence)**

- The PR is merged at a head with a non-author review that cites its evidence; no unresolved P0/P1.
- The three known refusals (`declare global`, an external re-export, `declare module`) are documented in the
  PR body as this spec's C-6 work, not fixed by growing #7.
- If the review finds the front-end shape wrong, stop and report; K4 replaces it then and no requirement
  changes.

---

- [ ] **U1 — Model v3, source index and manifest targets**

**Depends on:** U0 merged. **Requirements:** C-1..C-5, C-7, C-8, R-1..R-4, R-8.

**Files**

- `packages/api-extractor/src/model/api-model.schema.ts`
- `packages/api-extractor/src/model/message.schema.ts` (new; moved from `src/front-end/analysis-message.schema.ts`)
- `packages/api-extractor/src/model/serialise.ts`
- `packages/api-extractor/src/front-end/declarations.schema.ts`
- `packages/api-extractor/src/front-end/source-index.ts` (new)
- `packages/api-extractor/src/front-end/tsdoc.ts` (new; shared by the source index and `resolve-messages.ts`)
- `packages/api-extractor/src/front-end/read-package.ts`
- `packages/api-extractor/src/front-end/package-source.schema.ts`
- `packages/api-extractor/src/front-end/build-model.ts`
- `packages/api-extractor/src/front-end/analyse.ts`
- `packages/api-extractor/src/front-end/resolve-messages.ts`
- `packages/api-extractor/src/front-end/{oxc-isolated-emitter,typescript-7-compiler}.ts`
- `packages/api-extractor/src/FrontEnd.ts`
- the colocated schema laws and the `tests/` features.

**Steps**

1. Add `Anchor`, `ReleaseTag`, `ItemMeta`, `ManifestEntry`, `CoverageReason`, `PackageSurface` and `AnalysisMessage`
   to the model. Every item kind carries `anchor`, `releaseTag` and `stability`. `ApiModel` gains
   `anchorBase`, `package.exports`, `package.imports`, `messages` and `coverage`.
2. Bump `API_MODEL_SCHEMA_VERSION` to 3; update `sortModel` (messages, coverage reasons, manifest entries) and
   the codecs; the decoder refuses any other version. Add schema laws for every new schema.
3. Move `AnalysisMessage` beside the model, add `anchor`, and re-export it from `FrontEnd`.
4. Add `sources` to `Declarations`; both emitters populate it with the source texts they read.
5. Build `source-index.ts`: parse every source with `oxc-parser`, record top-level declarations
   `(name, kind, line)`, TSDoc release tags and `@stability` (a configured `TSDocParser` custom tag), and the
   re-export/ambient statement positions. Extract the shared comment/tag helpers into `tsdoc.ts`.
6. Extend `read-package.ts` and `package-source.schema.ts`: `targetPathOf` resolves the requested condition,
   then `types`, `import`, `default`, then the first string target; a single-string `exports` means `.`;
   decode `imports`; `PackageSource` carries `manifest`. Record the chosen condition and target on every
   entry point.
7. Attach `anchor`/`releaseTag`/`stability` in `build-model.ts` from the source index; attach message anchors
   in `resolve-messages.ts`; set `coverage` (`unsupported`, `unresolved`, `unmapped-anchor`, `pattern-empty`,
   `parse`, `external-star`).
8. `analyse` returns `{ route, model }` with messages and coverage in the model; `buildModel` keeps working
   for tests and the profile.

**Acceptance (evidence)**

- `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.
- A fixture whose `exports` is a plain string resolves its `.` entry point; a fixture with only
  `"imports": { "#internal/*": "./src/*" }` yields `entryPoints: []` and `coverage: complete` for the declared
  surface.
- A fixture declaration's anchor resolves to the expected source file and line; an unmapped symbol is
  `anchor: null` with an `unmapped-anchor` reason.
- `@public`/`@beta`/`@alpha`/`@internal` and `@stability` are recorded on the item; an untagged symbol is
  `untagged` and carries `ae-missing-release-tag`.
- A model with `schemaVersion: 2` is refused by the decoder.

---

- [ ] **U2 — Report schema, printer, renderer and `report`**

**Depends on:** U1 merged. **Requirements:** R-1..R-8, G2.

**Files**

- `packages/api-extractor/src/report/schema.ts` (new)
- `packages/api-extractor/src/report/print.ts` (new)
- `packages/api-extractor/src/report/render.ts` (new)
- `apps/api-extractor-cli/` (new app: `package.json`, `tsconfig.json`, `tsdown.config.ts`,
  `oxlint.config.ts`, `src/main.ts`, `src/commands/report.ts`)
- `apps/api-extractor-e2e/` for the report fixture
- `pnpm-workspace.yaml` (the app member), `flake.nix` if an output is needed for U4

**Steps**

1. Add `ApiReport = { reportVersion: 1, model }` with its schema laws and a decoder that refuses another
   version.
2. Write `print.ts`: `printType`, `printSignature`, `printItem`, `printAugmentation`; canonical union order,
   no locale, no absolute path.
3. Write `render.ts`: the fixed Markdown structure (header, entry points, locals, internal, augmentations,
   messages, coverage), the 16,000-character default cap and the deterministic truncation line with counts.
4. Add the CLI app with `NodeRuntime.runMain` and `NodeServices.layer`; implement `report --package ...` with
   `--workspace`, `--condition`, `--out` and `--stdout`; write `<pkg>.api-report.json` and `.md` through
   `canonicalJson`.
5. Add tests: schema laws; report JSON decode/refusal; Markdown sections; truncation counts; two runs
   byte-identical; no absolute path in either output.

**Acceptance (evidence)**

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
- A fixture report contains its entry points, locals, internal section, messages and coverage; the JSON
  decodes and a `reportVersion: 2` document is refused.
- A package with more symbols than the cap prints `... truncated: <shown> of <total> ...`; an untruncated
  package prints no such line.
- Two runs on the same fixture are byte-identical and contain no absolute path.

---

- [ ] **U3 — Change report, importer index and `diff`**

**Depends on:** U2 merged. **Requirements:** D-1..D-7, B-1..B-3, J-1.

**Files**

- `packages/api-extractor/src/diff/change.schema.ts` (add `path`, `anchor`)
- `packages/api-extractor/src/change/change-report.schema.ts` (new)
- `packages/api-extractor/src/change/import-index.ts` (new)
- `packages/api-extractor/src/change/diff-package.ts` (new)
- `packages/api-extractor/src/change/render.ts` (new)
- `packages/api-extractor/src/change/pr-comment.ts` (new)
- `apps/api-extractor-cli/src/commands/{diff,affected}.ts`
- `apps/api-extractor-cli/package.json` (the new commands)

**Steps**

1. Add `path` (structured) and `anchor` to `Change`; the diff copies item metadata. `@internal` items are
   skipped for the public diff and findings.
2. Add the `ChangeReport` schema from the design: `Revision`, `ChangeDetail` (with `surface`), `ManifestDelta`,
   `ImportsDelta`, `ImporterGroup`, `Importer`, `changes`, `findings`, `bump`, `messages`, `coverage`.
   `detailChanges` maps every change once with `classify`, the printed before/after signatures and the anchor.
3. Build `import-index.ts`: workspace packages from `pnpm ls --recursive --json --depth -1` (fallback to the
   `pnpm-workspace.yaml` globs), `oxc-parser` parse of every source/test file, static imports, re-exports,
   literal dynamic imports and literal `require`, type-only flags, package/self/`#` specifier resolution,
   production/test classification and the importer join.
4. Build `diff-package.ts`: resolve the refs, create the base worktree, symlink the head's `node_modules`
   where the base lacks them, analyse both revisions with the same tool, require equal model schema versions,
   diff, join importers, compute the map deltas and the bump, remove the worktrees it created. Never run
   `git clean`, `reset`, `stash` or `worktree prune`.
5. Build the bounded Markdown and PR comment: the fixed marker prefix,
   `<!-- api-extractor-change-report head=<sha40> -->`, the 48,000-character cap and the truncation list.
6. Implement `diff` and `affected` in the CLI, with canonical JSON, relative paths and the exit codes from the
   design.
7. Add tests: a two-commit temporary repository with an added export and a production importer, a test-only
   export, an added `#internal/*` map and an `@internal` change; importer classification; no-change versus
   refusal; internal change `bump: none`; comment truncation.

**Acceptance (evidence)**

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
- The fixture change report shows the added entry point and export, the production importer, the test-only
  importer counts, the `exports`/`imports` deltas and the internal change with `surface: "internal"` and
  `bump: "none"`.
- `bump: "none"` with `changes: []` and `coverage.complete: true` is distinguishable from a refusal artifact
  and from `coverage.partial`.
- The report names both revisions by SHA and carries no absolute path; the comment is under the cap and its
  marker carries the head SHA.

---

- [ ] **U4 — Reusable consumer workflow, comment and the judge proof (first deliverable)**

**Depends on:** U3 merged. **Requirements:** J-0..J-5, I-2..I-5, G1.

**Files**

- `.github/workflows/api-report.yml` (new, `workflow_call`)
- `apps/api-extractor-cli/src/commands/comment.ts` (new)
- `flake.nix` (`packages.api-extractor-cli`)
- a caller workflow in the private consumer repository (outside this repository) and its PR

**Steps**

1. Add the reusable workflow with `tool-ref` (a full SHA in this public repository), `base-ref`, `head-ref`,
   `packages`, `mode` (`affected` or `corpus`) and `comment`; the caller grants `contents: read`,
   `pull-requests: write` and `actions: read`; no secrets.
2. Steps: checkout the consumer at the head with full history; checkout this repository at `tool-ref`; build
   the CLI (`nix build .#api-extractor-cli`); select packages; run `diff` (or `corpus`); upload
   `api-reports-<headSha>`; run `check-bump`; post or update the comment; write the summary with analysed,
   skipped, partial and wall time.
3. Implement `comment`: read `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and the event's PR number, find the comment by
   the marker prefix, `PATCH` it or `POST` it, and never duplicate it.
4. Add the caller workflow in the private consumer repository for one real PR, with `tool-ref` pinned to the
   merged tool head.
5. Run the real PR: the comment and JSON artifacts appear; the review judge consumes the Markdown and answers
   the export-smuggling and test-on-internals questions with the report lines it relied on. Record the PR
   number, the head SHA, the artifact id and the cited lines.

**Acceptance (evidence)**

- The workflow runs on the real PR with no secret configured; the comment is posted once and updated on a
  second push; the artifact exists and is named with the package and the head SHA.
- The job summary names analysed, skipped and partial packages and its wall time; a PR touching at most three
  packages completes within two minutes.
- The judge's answer is recorded with the artifact id and the report lines it cited; the test-only
  `#internal/*` case answers yes and a real added public API with a production consumer answers no.
- A forced tool failure posts `report unavailable: <reason>` and the judge records `Unclear`, not a pass.
- This PR adds no corpus job, benchmark or changeset check.

---

- [ ] **U5 — Model v4: external re-exports and ambient declarations**

**Depends on:** U1 merged; U4 may run in parallel because it does not touch the model. **Requirements:** C-6,
R-8, G3.

**Files**

- `packages/api-extractor/src/model/api-model.schema.ts` (`ExternalItem`, `ExternalStar`, `Augmentation`,
  `ExternalStar` on `EntryPoint`)
- `packages/api-extractor/src/front-end/declaration-graph.ts`
- `packages/api-extractor/src/front-end/build-model.ts`
- `packages/api-extractor/src/report/print.ts`, `render.ts`
- the colocated laws and `tests/` features

**Steps**

1. Bump `API_MODEL_SCHEMA_VERSION` to 4; add the v4 types and their schema laws.
2. Stop refusing `symbol.kind === 'external'`: build an `ExternalItem`. Record `export * from 'pkg'` as an
   `ExternalStar`.
3. Record `declare global` and `declare module 'x'` blocks in the declaration graph; build `Augmentation`s
   with their items and anchors.
4. Print external items, external stars and augmentations; the change report treats external additions and
   removals as export changes and marks a star incomplete with `external-star`.
5. Add fixtures for the three previously refused constructs and for an external star, a renamed external
   re-export, a global augmentation and a module augmentation.

**Acceptance (evidence)**

- The three fixtures that were refused now produce reports; the external item prints its module and name; the
  star prints and the coverage names `external-star`.
- An added/removed global member is a change; the ambient section prints; the model version is 4 and a v3
  model is refused.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.

---

- [ ] **U6 — Corpus job**

**Depends on:** U5 merged (the corpus includes the three previously refused packages); U4 merged (the CLI is
buildable in CI). **Requirements:** C-1..C-7, I-1, I-4, G3.

**Files**

- `.github/workflows/ci.yml` (new `api-corpus` job)
- `apps/api-extractor-cli/src/commands/corpus.ts` if it is not already in U2
- `flake.nix` if the corpus install needs a cache output

**Steps**

1. Add `api-corpus`, `needs: sfs-deps`, `timeout-minutes: 10`: checkout this repository; download `.sfs-deps`;
   install; build the CLI.
2. Checkout the public package monorepo at the pinned corpus SHA into `corpus/public`; install its
   dependencies with `pnpm install --frozen-lockfile`, cached by the corpus SHA and lockfile hash.
3. Run `api-extractor corpus --repo corpus/public --out api-corpus`.
4. Re-run five packages by name into `api-corpus-2` and compare the two trees byte for byte.
5. Upload `api-corpus`; fail on an untyped refusal, an omitted package, a partial package or a byte
   difference; the summary names the file and construct and the install/analysis times.

**Acceptance (evidence)**

- The job is green on the PR head; the summary reports 48 packages, 46 with `exports`, 119 declared subpaths
  (or the pinned corpus's counts) and the partial list; the five-package comparison is identical.
- The job completes within ten minutes and records the install and analysis times.
- A fixture package with an unsupported construct fails the job with its file and construct, so the job cannot
  pass by skipping it.
- The job is not added to the required checks.

---

- [ ] **U7 — `check-bump`**

**Depends on:** U4 merged (the workflow calls it). **Requirements:** B-4, B-5, G5.

**Files**

- `apps/api-extractor-cli/src/commands/check-bump.ts`
- `.github/workflows/api-report.yml` (the step already sketched in U4)
- tests for the changeset parser and the comparison

**Steps**

1. Parse `.changeset/*.md` frontmatter: the block between the first two `---` lines, one `"<pkg>": <bump>`
   entry per line; the highest of several entries wins; quoted/unquoted keys, blank lines and the four values
   are handled; anything else is an input error (exit 2).
2. Compare per package: declared lower than the report bump fails; a required non-`none` bump with no entry
   fails; `coverage.complete: false` fails with the reason; otherwise pass.
3. The failure names the package, the declared bump, the required bump, the top finding's `reasonCode` and its
   anchor.
4. Run it in the consumer workflow after the reports and record the result in the summary and the comment.

**Acceptance (evidence)**

- A real PR with a changeset declaring `minor` for a `major` change fails naming `E_WIDENED` and its anchor; a
  correct `major` passes; a PR with no public change and no changeset passes; a partial report fails with the
  reason.
- The check reads the report JSON and the changeset files, never source text; changing only its configuration
  cannot make it pass.

---

- [ ] **U8 — Benchmark and profile**

**Depends on:** U6 merged (the corpus checkout and artifacts exist). **Requirements:** P-1, P-2, P-5, G6.

**Files**

- `apps/api-extractor-bench/` (new app: `main.ts`, `package.json`, `tsconfig.json`, `tsdown.config.ts`,
  `oxlint.config.ts`)
- `apps/api-extractor-profile/profile.ts` (new phases)
- `.github/workflows/ci.yml` (`api-bench` job, not required)
- `pnpm-workspace.yaml`, `flake.nix` as needed
- `docs/profiles/` (the new profile record)

**Steps**

1. Add the benchmark: for each corpus package, run our `report` from source and upstream
   `@microsoft/api-extractor` 7.59.4 end to end (its bundled TypeScript 5.9.3 emit plus the extractor), cold
   and five warm medians.
2. Record per-package and total wall clock, the phase breakdown, the corpus SHA, the tool versions and the
   host; list upstream-refused packages and exclude them from the ratio; target at least 10x, otherwise state
   the ceiling and the phase.
3. Extend the profile with `report:json`, `report:markdown`, `change:diff` and `change:import-index`.
4. Add the `api-bench` job within the ten-minute budget and upload `benchmark.json`/`.md`.

**Acceptance (evidence)**

- `benchmark.json`/`.md` exist on the PR head with the ratio or the ceiling, the excluded list and the phase;
  the profile record names the corpus SHA and the host.
- The benchmark is not a required check; the job summary records its wall time.

---

- [ ] **U9 — TypeScript 7.1 adapter and semantic conformance**

**Depends on:** U8 merged. **Requirements:** P-3, P-4.

**Files**

- `packages/api-extractor/src/front-end/typescript-7-1-compiler.ts` (new, behind the emitter port)
- `packages/api-extractor/src/front-end/declaration-emitter.service.ts` if the capability check needs a field
- `apps/api-extractor-conformance/` (new app)
- fixtures and `differences.md`

**Steps**

1. Add the 7.1 adapter behind `CompilerEmitter`: when the dependency resolves `typescript/sync`, emit through
   the `API` snapshot; otherwise keep the process adapter. The adapter is selected by capability, not by a
   model flag.
2. Add the port conformance test: a double and the process adapter produce equal models once
   `producer.declarations` is set equal.
3. Add the conformance app: run our model and upstream `.api.json` on the fixture corpus (subpaths,
   `export * as`, external re-exports, `declare global`, `declare module`, overloads, dual APIs, value/type
   pair, re-export cycle); compare entry points, export names, kinds and normalised declaration text.
4. Record every difference in `differences.md` with its fixture, evidence and Effect-aware reason.

**Acceptance (evidence)**

- The port test passes and the model schema version is unchanged by the adapter choice.
- The conformance lane runs on the PR head; every difference is fixed or recorded; no byte comparison of
  `.api.md` is a gate.

---

- [ ] **U10 — E2E determinism and the durable counterfactual**

**Depends on:** U2, U3 and U5 merged. **Requirements:** R-7, Q-1..Q-5.

**Files**

- `apps/api-extractor-e2e/tests/locale-determinism.integration.test.ts`
- `apps/api-extractor-e2e/host-digest.ts`, `outputs.ts`
- `docs/solutions/<date>-<slug>.md` only if a durable counterfactual exists

**Steps**

1. Extend the locale/time-zone/working-directory probe with a report and a change report; each child writes
   the same bytes as the parent and reports the locale, time zone and working directory it resolved.
2. Extend `host-digest.ts` with a report and a change report; the cross-host comparison covers both.
3. Run the preset's lint/typecheck/test lanes; confirm the single `.` export and the absence of locale APIs
   (`grep -nE 'toLocale|localeCompare|Intl\\.' packages/api-extractor/src` prints nothing).
4. Add one `docs/solutions/` entry only for a durable counterfactual (a mistake a future agent would repeat);
   otherwise record the skip reason in the PR body.

**Acceptance (evidence)**

- The e2e children under `LC_ALL=C`, `LC_ALL=tr_TR.UTF-8` and a different time zone and working directory
  produce identical report and change-report bytes; the cross-host digest includes both.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass; the package export map is unchanged; the locale grep is
  empty.
- The `docs/solutions/` decision is recorded (one entry or an accepted skip).

---

## Final check

- [ ] U0-U10 merged, each on its own PR from `main`, each with the merge bar met at its head.
- [ ] M1 (U1-U4) shipped before the corpus job, benchmark and changeset check; the judge read the change
  report on a real PR and its cited lines are recorded.
- [ ] The corpus job reports every package in the public corpus and, through the reusable workflow's `corpus`
  mode, every package in the private consumer repository; no package is silently omitted.
- [ ] The private-reference scrub returns 0 for every spec and report document that enters this repository.
- [ ] Nothing in this repository names a private repository, package or person, and no private corpus
  checkout, report or artifact is committed here.
