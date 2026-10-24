# api-extractor-sota: requirements

Date: 2026-10-24. Type: feature. Working directory: `systemfsoftware/api-extractor-effect`.
Supersedes, for the scope below: `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md` requirements
R8, R9 and units U8-U10, and `docs/plans/2026-10-14-0214-feat-front-ends-plan.md` where it defers to them.

## 1. Purpose

`@systemfsoftware/api-extractor` becomes the organisation's public-API authority. It reduces a TypeScript package's
real public surface to one versioned API model, renders that model as a public-API report, and diffs a base
and a head revision of the same package into a change report that carries three facts: what changed in the
public surface, who imports each added export, and the semver bump the change requires.

The change report is the evidence for two consumers:

1. **The review judge.** Its export-smuggling rule and its test-on-internals rule judge a PR's public-API
   change and its new subpaths and internal import aliases. The judge reads the change report instead of
   reconstructing the surface from raw source. The judgement belongs to the judge's decision model; this tool
   supplies facts and never decides that an export is "smuggled".
2. **The changeset bump check.** The bump for each package is decided from the API diff, not from the
   changeset author's claim; a PR whose changeset under-declares the bump fails the check.

The tool is Effect-native, runs on source (no build required), works on every package in the public package
monorepo and in the private consumer repository, including subpath `exports` maps, `export * as X` barrels,
`#x/*` `imports` maps and private application packages, and is at least an order of magnitude faster than
`@microsoft/api-extractor` 7.59.4 on the same packages.

## 2. Outcome (Done)

**First deliverable.** The change report the review judge reads ships first. On a real PR in the private
consumer repository, CI produces the change report for the affected packages and the judge answers its
export-smuggling and test-on-internals questions from it. The model additions and the report slice that diff
needs — per-symbol signatures, anchors, release tags, `exports`/`imports` map facts — ship with it. The
full-package report view, the corpus-wide job, the benchmark, the CLI polish and the changeset check follow
in that order (J-0).

Done is all six predicates, each checked by a separate evaluator with the evidence named here.

- **G1 — The report diff the judge reads (first deliverable).** On a real PR in the private consumer
  repository, CI produces the change report for every affected package at the PR head, and the review judge,
  running the review-judge specification, consumes it and answers its export-smuggling and test-on-internals
  questions with the report lines it relied on. On the test-only internal-import evidence (an application
  package with a `#internal/*` imports map serving tests) it answers yes; on a real added public API with
  non-test consumers it answers no. This predicate is met before the full report view, the corpus job, the
  benchmark and the bump check exist.
- **G2 — Public-API report.** Every package the tool accepts has a head-revision report: its entry points and
  exports with declaration-style signatures, anchors, release tags, namespaces, internal section, analysis
  messages and coverage; canonical JSON plus a bounded Markdown view.
- **G3 — Corpus coverage.** A report exists for every workspace package in both corpora: the public package
  monorepo at the corpus SHA the benchmark pins (48 packages, 46 with an `exports` map, 119 declared subpaths
  at `f36e00fba`, measured 2026-10-24) and the private consumer repository at its corpus SHA, with every
  workspace package reported. Zero packages are silently omitted, and every package that cannot be reported
  names the file and the construct that stopped it.
- **G4 — CI production.** On a real PR in the private consumer repository, CI produces the change report for
  every affected package at the PR head and publishes it where the judge reads it. The job names the packages
  it analysed, the ones it skipped and why, and its wall time.
- **G5 — Bump check.** A PR that declares a smaller changeset bump than the API diff requires fails a check
  whose message names the package, the declared bump, the required bump and the finding behind it. A PR with
  a correct bump, or with no public-API change and no changeset, passes.
- **G6 — Speed and the state of the art.** The end-to-end run (source discovery through report) is at least
  10x faster than `@microsoft/api-extractor` 7.59.4 on the same corpus, or the benchmark reports the measured
  ceiling and the phase that stops it. A package that emits isolated declarations without a diagnostic never
  runs a type checker. TypeScript 7.1's new programmatic API is an adapter behind the emitter port, not a
  rewrite.

## 3. Research basis (2026-10-24)

Two independent surveys were run — Gemini 3.8 Flash through OpenRouter and Grok through grok.com — and every
version and API claim used below was then re-checked against npm or a primary announcement. The surveys'
architectural opinions are not load-bearing; the decisions in §3.2 rest on the checked facts and on this
repository's own measurements.

### 3.1 Verified facts

| Fact | Source (checked 2026-10-24) |
|---|---|
| `@microsoft/api-extractor` is 7.59.4 (published 2026-10-06), MIT, depends on `typescript` 5.9.3; `@microsoft/api-extractor-model` 7.33.15 and `@microsoft/api-documenter` 7.30.18 ship with it. It produces a `.api.md` report, a `.d.ts` rollup and an `.api.json` model. | npm registry metadata for the three packages |
| `typescript` latest is 7.0.2 (2026-07-08); `7.1.0-beta` shipped 2026-10-20; `next` is `7.1.0-dev.20261023.1`. | npm registry dist-tags |
| TypeScript 7 does not expose a stable programmatic API; TypeScript 7.1 Beta ships the new API with entry points `typescript/sync`, `typescript/async`, `typescript/fs` and `typescript/ast`, with an RC about a month later and a final release after it. | `devblogs.microsoft.com/typescript/announcing-typescript-7-0/`, `.../announcing-typescript-7-1-beta/` |
| The declared-package-emitter line in 2026: `oxc-transform` 0.155.0 (2026-10-19), `rolldown-plugin-dts` 0.28.8 (2026-10-11), `tsdown` 0.23.2 (2026-10-23). | npm registry metadata |
| The documentation-model line: `typedoc` 0.28.20, `@arethetypeswrong/cli` 0.18.5, `publint` 0.3.25, `knip` 6.42.1. | npm registry metadata |
| The two closest TypeScript API-diff tools are published, small and active: `@clerk/break-check` 0.6.0 and `@api-extractor-tools/change-detector` 0.1.0. Both were reported by the survey to operate on api-extractor output; the survey's description is not load-bearing here. | npm registry metadata; survey |
| `cargo-semver-checks` reads rustdoc JSON and expresses each lint as a Trustfall query over that versioned model; that model-plus-declarative-queries shape is the ecosystem's strongest prior art for semver checking. | `github.com/obi1kenobi/cargo-semver-checks` README |
| This repository's own profile measured 40 packages and 585 source files: `emit:oxc-transform` 25.74 ms, `emit:tsc7` 9,992.59 ms, `emit:tsc5.9.3` 67,206.59 ms, `build:model` 274.59 ms, `resolve:messages` 132.58 ms. TypeScript 7 and 5.9.3 printed 126 of 585 declaration files differently. | `docs/profiles/2026-10-13-front-end-phases.md` on PR #7 |
| The same profile shows three of 40 packages refused for constructs that are legal TypeScript: `declare global` (the atom package), an external re-export (the Gherkin-spec package), `declare module "vitest"` (the vitest package). | same profile |
| The current model is `schemaVersion` 2; the rule corpus is 61 rules at `corpusVersion` 1.1.0; PR #7 (head `3deadf9c`) adds `FrontEnd.analyse`, +18,820/−43 lines over 57 files, is mergeable and unreviewed since 2026-10-14. | `packages/api-extractor/src/model/api-model.schema.ts`, `src/rules/corpus.v1.json`, `gh pr view 7` |
| A private consumer monorepo's packages export TypeScript source directly (`"exports": { ".": "./src/mod.ts" }`) and are `private: true`; one application package there has an `imports` map (`"#internal/*": "./src/*"`) and no `exports` map. Its SHAs and counts are pinned in the corpus job's configuration, not in this document. | The private consumer repository's manifests at the SHA its CI pins. |
| The review judge's current export fact (`export_delta`) is the `package.json` export maps at base/head plus head importers classified production/test/type-only; its `test_imports` fact classifies changed tests' imports as declared, undeclared or relative-`src`. The rule families are judged by the review judge model; facts are evidence, never regex gates. | The review-judge specification, held outside this repository (its fact names and rule families). |

### 3.2 Keep, replace and delete

**Keep.** The versioned Effect Schema model, the canonical serialiser, the position-polarity and Effect
`A`/`E`/`R` diff, the declarative rule corpus and semver verdict, the emitter port with an
isolated-declarations fast path and a compiler fallback, and the one-model hub. No mainstream tool models
Effect channels; this is the part that must not be rebuilt.

**Replace.** The upstream-compatible `.api.md` report as the product. The product report is rendered from
this tool's model, in a declaration style a reviewer or judge can read, with its own format version. The
upstream byte comparison and the port of upstream's sort key go with it: this repository measured that
TypeScript 7 and 5.9.3 print 126 of 585 declaration files differently, so byte identity is tied to the
oracle's compiler line, and no consumer of this spec reads upstream-formatted bytes. The upstream oracle is
kept as a **semantic** conformance lane: `@microsoft/api-extractor` 7.59.4's `.api.json` is compared on
entry points, export names, kinds and normalised signatures for a curated fixture corpus. A mismatch is
either fixed or recorded as a deliberate Effect-aware extension with its evidence.

**Delete.** The six-PR sequencing as the plan of record; the `.api.json`/api-documenter emitter goal; the
report-parity rule that the compiler fallback must emit with the oracle's TypeScript 5.9.3; the "public
packages only" assumption; and the byte-for-byte differential lane. The remaining scope is re-cut by this
spec's design and tasks, one deployable unit per PR.

**Not adopted.** A Deno doc or TypeDoc model (documentation models, not semver or Effect-aware, and TypeDoc's
reflection JSON is large); `knip` (unused-export analysis answers a different question than "who imports this
new export at head"); SARIF (verbose, no consumer in this spec); and a bundled `.d.ts` build output
(`tsdown`/`rolldown` own build artifacts; this tool analyses).

## 4. Definitions

- **Package.** A workspace package directory with a `package.json` that has a `name`. It may be public or
  `private`, published or source-exporting.
- **Entry point.** One key of the package's `exports` map (`.`, `./name`, or one path resolved from a `./*`
  pattern), reduced to the target that consumers resolve. A package with no `exports` map has no public entry
  points.
- **Public surface.** The entry points and the symbols reachable from them by re-export, after `export * as
  X` and `export *` rollup, excluding symbols tagged `@internal`.
- **Internal surface.** The package's `imports` map entries (`#x/*`), its `@internal` exports, and its
  non-exported locals that appear in public signatures.
- **API report.** The head-revision artifact for one package: canonical JSON plus a declaration-style
  Markdown view.
- **Change report.** The base-versus-head artifact for one package: the API diff, the importers of every
  added export, the `imports`-map delta, the analysis messages, the coverage and the bump.
- **Importer.** A file outside the package that imports a public specifier of the package, or a file inside
  the package that imports its own public specifier (`self`). A relative path into `src/` is not an importer
  of the public surface.
- **Anchor.** The repository-relative source file and 1-based line of the declaration that a report symbol
  came from.
- **Judge.** The review judge model driven by the review-judge specification; it rules on export smuggling
  and tests on internals. This tool never rules.
- **Bump.** `major`, `minor`, `patch` or `none`, decided by the rule corpus from the API diff.
- **Corpus.** The two pinned workspace checkouts: the public package monorepo and the private consumer
  repository, each named by commit SHA in the benchmark and corpus job configuration.

## 5. Requirements

Each requirement has an acceptance criterion. Requirement text is normative; the facts behind it are cited in
§3.1 and §10.

### 5.1 Coverage and inputs (C)

**C-1 Workspace discovery.** Given a repository root, the tool discovers every workspace package from the
workspace manifest and analyses each package that has an entry point or an `imports` map. The run prints the
package count, the entry-point count and the report count.
*Acceptance.* On the public package monorepo at the pinned SHA the run reports 48 packages and 119 declared
subpaths (46 packages with `exports`); on the private consumer repository at its pinned SHA every workspace
package appears exactly once in the run summary.

**C-2 Source-exporting and private packages.** A package whose `exports` map targets `.ts` source, and a
package with `"private": true`, are analysed from source; no build, `dist/`, or package publish is required.
The report names the export target it analysed (source file and export key).
*Acceptance.* Every package in the private consumer repository produces a report at its pinned SHA; a
private source-exporting fixture package reports the nine entry points its manifest declares.

**C-3 Subpaths, patterns and conditions.** Every `exports` key is an entry point. A `./*` pattern key is
expanded by walking the package, deterministically and within a fixed directory budget; exceeding the budget
is a typed refusal naming the key. Conditions are resolved to the target a consumer sees (the `types` or
source target, not the runtime JavaScript); the report names the chosen condition or target.
*Acceptance.* `@systemfsoftware/tsconfig` reports its 22 subpaths; a fixture package with 40 subpaths and one
with 51 report theirs; a pattern package resolves the same entry-point set on two runs. A pattern that
resolves zero entries is a typed refusal, never a silent empty surface.

**C-4 Barrels and re-exports.** `export * as X` is a namespace export with its members; `export *` and named
re-exports are followed to their declarations; a re-export cycle terminates; a value and a type sharing one
name both appear (declaration merging is legal, not noise).
*Acceptance.* A fixture package with fourteen `export * as` namespaces (`NamespaceA` through `NamespaceN`)
reports each namespace with its members; a fixture with a re-export cycle and a value/type pair reports both
symbols and terminates.

**C-5 Imports maps and application packages.** An `imports` map (`#x/*`) is internal surface: its entries are
never public entry points, are listed in the report, and their delta is reported in the change report. A
package with an `imports` map and no `exports` map (an application) is a valid input with zero public entry
points; it is not an error and is not omitted.
*Acceptance.* A fixture application package (`"imports": { "#internal/*": "./src/*" }`, no `exports`) yields
a report with `entryPoints: []`, the imports map entries listed, and `coverage: complete` for the declared
surface. A package with neither `exports` nor `imports` is reported as having no declared surface, with that
reason.

**C-6 External re-exports and ambient declarations.** A named re-export from another module
(`export { X } from 'pkg'`) is part of the public surface and is represented by its module specifier and
name. An `export * from 'pkg'` is represented as an external star re-export and marks symbol enumeration
incomplete for that entry point. `declare global` and `declare module 'x'` augmentations are represented in
their own section and are part of the surface for change detection.
*Acceptance.* The three packages refused at the profile's pinned SHA — the atom package (`declare global`),
the Gherkin-spec package (external re-export) and the vitest package (`declare module "vitest"`) — produce
reports. An added global augmentation is a change in the report; a removed one is a change too. An external
re-export whose module cannot be resolved is still reported with its specifier.

**C-7 Refusal honesty.** A construct the front-end cannot model, an entry point that does not resolve, or an
unresolvable external import produces `coverage: partial` with the file and the construct or reason. No
package is silently omitted, and no partial model is presented as complete.
*Acceptance.* A fixture with an unsupported construct reports `partial` and names the construct; the corpus
run prints the list of partial packages; a spot check of every `complete` report finds no dropped export.

**C-8 No silent `any`.** A type the model does not decompose is kept as canonical text, not `any`; a change
in that text is a change.
*Acceptance.* A fixture whose only change is inside an opaque conditional type produces a `type-changed`
change, not `none`.

### 5.2 The public-API report (R)

**R-1 One model, one renderer.** The report is rendered from the decoded model only. The renderer does not
re-parse TypeScript, and the diff reads models, never rendered text.
*Acceptance.* A report can be rendered from a stored model JSON file with no source checkout; changing the
renderer cannot change a diff.

**R-2 Report content.** Per package the report contains: package name and version; the producer (engine
version and declaration emitter); the report and model schema versions; every entry point with its export
key, source target and exports; for every export its kind, declaration-style signature, type parameters,
release tag or stability annotation, and anchor; namespace nesting; the non-exported locals that public
signatures reference; the analysis messages; and the coverage with reasons.
*Acceptance.* A reviewer can answer "what is public in this package, and where is it declared" from the
report alone. Every signature in the report is the signature the model holds; no symbol is printed that is
not in the model.

**R-3 Release tags and stability.** `@public`, `@beta`, `@alpha` and `@internal` are recorded for every
export; an `@internal` export is listed in an internal section and excluded from the public surface; an
untagged export is flagged with the missing-release-tag message. Effect's `@stability` annotation is recorded
where present.
*Acceptance.* An `@internal` export does not appear in the public surface and does appear in the internal
section; removing `@internal` from that export is a public-surface addition; an untagged export carries the
message.

**R-4 Anchors.** Every exported symbol and namespace member carries an anchor: repository-relative source
file and 1-based line. When an emitter cannot map a declaration back to source, the anchor is `null`, the
symbol is listed, and the report marks anchor coverage partial for that entry point; it never invents a
location.
*Acceptance.* Ten spot-checked anchors across the two corpora resolve to the declaration's source line. A
judge finding can cite `path:line` from the report and the path exists at the head revision.

**R-5 Canonical JSON.** The API report's JSON is written through `canonicalJson`: code-unit key order,
two-space indent, trailing newline, no locale-dependent output. It carries `reportVersion`; decoding rejects
another version.
*Acceptance.* The same model written twice is byte-identical; a report with a different `reportVersion` is
refused by the decoder with that version named.

**R-6 Bounded Markdown.** The Markdown view is a rollup-style declaration block per entry point — the public
surface written as TypeScript declarations, after `export * as X` and `export *` rollup, with each symbol's
anchor — public and internal separated. It is capped at 16,000 characters per package by default; when
truncated it says so and prints the counts and the path or id of the full JSON. The cap is a parameter, not a
constant in the renderer.
*Acceptance.* A package with more public symbols than the cap prints a truncation line with the exact counts;
an untruncated package prints no truncation line. A reader can paste an entry point's block into a `.d.ts`
file's body and see the same surface, with namespaces and members shown under their namespace.

```text
### @example/library 0.0.0 — entry point "." (head 0000000)
export namespace NamespaceA {
  export function list(...): Effect<ReadonlyArray<Item>, ItemError, never>   src/namespace-a/mod.ts:12
}
```

**R-7 Determinism.** Every report and change report is byte-identical across process locales (including
`tr_TR.UTF-8`), time zones, working directories and hosts. The existing process-level determinism proof is
extended to the report and change report.
*Acceptance.* The e2e children under their locale, time-zone and working-directory variants produce identical
bytes; the cross-host CI comparison includes a report and a change report.

**R-8 Versioning.** Any change to the model schema bumps `API_MODEL_SCHEMA_VERSION`; the report and change
report carry their own versions; a corpus change bumps `corpusVersion`. Anchors, release tags and ambient
declarations are model additions and bump the model version in the unit that adds them.
*Acceptance.* A model written by the new engine carries the new `schemaVersion`, and the old decoder refuses
it; the report names the model version it decoded.

### 5.3 The change report and importers (D)

**D-1 Two revisions, one package.** The change report is produced from a base revision and a head revision of
the same package, each reduced to a model by the same analyzer. It never diffs rendered text, and it never
mixes two packages.
*Acceptance.* The same package at base and head yields a change report even when the working tree has no
build; a report names both revisions by commit SHA and both entry-point sets.

**D-2 Change content.** Every change carries: kind, location, before and after signature text where a
signature changed, position (`in`, `out`, `both`), Effect channel when the change sits under one, direction
when the type lattice decides one, and the bump and reason the corpus assigns. Entry-point additions and
removals, export additions and removals, overload and dual-form changes, parameter and member changes, enum
changes, heritage changes and type changes are all represented.
*Acceptance.* The existing verdict acceptance examples hold through the change report: `E` widened in output
is major `E_WIDENED`; `E` widened in input is minor; a dual form removed is major `DUAL_FORM_REMOVED`; an
unclassified change is major `UNCLASSIFIED_CHANGE`.

**D-3 Importers of added exports.** For every added entry point and every added export, the change report
lists the head-revision importers: importer package, file, specifier, imported names, `usage` (`production`
or `test`), `typeOnly` and `self`. A file is a test when its path matches the workspace's test conventions
(`.test.`, `.spec.`, `__tests__/`, `tests/`); every other file is production. An export with no importer has
an empty list, never an "unknown".
*Acceptance.* A new public export imported by another package's source lists that package and file as
production; the same export imported only by tests lists only test importers; an unreferenced export lists an
empty array. The importer index is built by parsing TypeScript/TSX with a parser, not by matching text.

**D-4 Map deltas.** The change report lists, between base and head, the `exports` map delta (keys and
targets added, removed or retargeted) and the `imports` map delta (entries added, removed or widened, with
the specifier each resolves and the files that import it). It also lists `@internal` export changes.
*Acceptance.* Adding `"#internal/*": "./src/*"` to an application package produces an internal-surface delta
naming the map entry and every file that imports `#internal/...`; adding a `./public-api` key produces an
`exports`-map delta beside the entry-point change; the public bump for the `imports` delta alone is `none`.

**D-5 Facts, never a verdict on smuggling.** The tool reports importer lists, internal-surface deltas and
signatures. It has no rule id that says "smuggled", no threshold that fails a PR for having zero non-test
importers, and no text or regex judgement. The decision belongs to the review judge under the review-judge
specification.
*Acceptance.* The change report for a test-only export contains the empty production importer list and the
test importers; the tool's own corpus has no smuggling rule; the check that consumes the report for the judge
is the judge's, not this tool's.

**D-6 No change versus no report.** A package with no public-API change yields a change report with
`bump: "none"` and zero changes. A package that could not be analysed yields a typed error or a change report
with `coverage: partial` and the reason. The two are never represented by the same artifact.
*Acceptance.* A consumer can distinguish the two by decoding the artifact: the first has a complete coverage
and an empty change list; the second names its reason.

**D-7 Bounded Markdown for the PR.** The change report's Markdown view is one bounded document per PR: one
section per package, the bump for each, added exports with their importer counts and anchors, and the
internal-surface delta. It is capped at 48,000 characters for the whole comment by default; truncation names
the affected packages and points at the JSON artifacts.
*Acceptance.* A PR touching five packages with large surfaces produces one comment under the cap; the
truncation line lists the packages whose sections were shortened; the JSON artifact for each package is
complete.

### 5.4 The semver verdict and the bump check (B)

**B-1 Bump per package.** The change report carries one bump per package: the highest bump among its findings;
`none` when there are no changes. The rule corpus, not code, decides which change maps to which bump.
*Acceptance.* Adding an export is minor, removing one is major, changing an Effect `E` channel in output is
major, and a corpus with no matching rule yields major `UNCLASSIFIED_CHANGE`.

**B-2 Effect-aware rules stand.** The existing `A`/`E`/`R` channel rules, input/output polarity and dual-form
rules are the corpus of record; the change report's findings are the existing verdict findings, with
locations taken from the report's anchors.
*Acceptance.* The published acceptance examples (`E` widened, `E` tag removed, dual form removed) produce the
same reason codes as the verdict does today.

**B-3 Fail closed.** A change the corpus cannot classify is major with `UNCLASSIFIED_CHANGE`; a corpus that
cannot pick one rule per change is refused. No change is dropped.
*Acceptance.* A corpus with a missing rule yields major; a corpus with two matching rules is refused naming
the match.

**B-4 Changeset check.** A CI job compares, per affected package, the bump declared in the PR's changesets
with the bump from the change report. It fails when the declared bump is lower, when a required bump has no
changeset, or when the report is partial and the missing surface could contain the change. Its message names
the package, the declared bump, the required bump and the top finding's reason code and anchor. A package
with `none` requires no changeset.
*Acceptance.* A PR declaring `minor` for a `major` change fails with the finding named; a PR declaring
`major` passes; a PR with no public-API change and no changeset passes; a PR whose report is partial fails
with the reason, not with a fabricated bump.

**B-5 Not a tautology.** The check reads the real base/head API diff, not a file the PR itself writes. It is
proven on a real under-declared changeset, not by asserting configuration text.
*Acceptance.* The check's evidence is the change report artifacts and the changeset files at the PR head;
changing only the check's configuration cannot make it pass.

### 5.5 The judge contract and the first deliverable (J)

**J-0 First deliverable.** The first unit that ships produces the change report for one real package in the
private consumer repository and lets the review judge read it on a real PR. It ships the model additions that
diff needs — anchors, release tags, `exports`/`imports` map facts — and the change report's canonical JSON and
bounded Markdown. It does not wait for the full-package API report view, the corpus-wide job, the benchmark,
the CLI polish or the changeset check; those follow it, in that order, each shipping independently on trunk.
*Acceptance.* The PR that ships the first unit adds no corpus job, benchmark or changeset check; its
evidence is the judge's answer on the real PR, with the report artifact id and the report lines it cited.

**J-1 The artifact the judge reads.** The change report's canonical JSON is the machine view and its bounded
Markdown is the judge's primary view. The JSON exposes, for each changed symbol: entry point, symbol path,
kind, before/after signature, position, channel, bump, anchor, and importers; and for the package, the
`exports` and `imports` map deltas and the coverage. The judge's `export_delta` and `test_imports` facts may
be derived from it; its export-smuggling and test-on-internals rules consume it.
*Acceptance.* The judge's fact pre-pass can build `export_delta` from the report without a checkout; a report
line cited by the judge names a symbol and an anchor that exists at head.

**J-2 The write-time agent layer.** When a lane changes a test file, a `package.json` `exports` or `imports`
map, or a module reachable from an entry point, the layer runs one local command on the lane's worktree with
the PR base as the base revision and passes the change report to the review judge model. The command needs no
network and no service.
*Acceptance.* The command runs on a lane worktree with only the repository's normal dev dependencies; its
JSON and Markdown are the same artifacts CI publishes for the same commit.

**J-3 The PR reviewer.** The PR reviewer consumes the change report published by CI and judges; it does not
recompute the public surface from raw source, and it never asks this tool for a smuggling verdict. The
comment carries a stable marker (the tool name and the head SHA) so the judge's pre-pass can select it; the
report job finishes inside the judge's five-minute deadline, and the judge waits for the report within that
deadline. A report that never arrives makes the export and internal-import rules `Unclear`, never a pass.
*Acceptance.* On a real PR the judge's finding cites report lines; the judge still produces findings for
rules outside this tool's scope (assertions, suppressions, snapshots, stories); on a PR whose report job
failed, the judge records `Unclear` for those two rules and says the report is missing.

**J-4 Proof on a real PR.** The proof is one real PR in the private consumer repository: the judge answers
its export-smuggling and test-on-internals questions from the report. The test-only `#internal/*` evidence
answers yes with the report lines that show the map and the test importers; a real added public API with a
production consumer answers no.
*Acceptance.* Both answers are recorded with the PR number, the head SHA, the report artifact id and the
judge's cited lines.

**J-5 The tool is not the gate.** No required check fails a PR because this tool reports zero non-test
importers. The judge's precision gate decides blocking under the review-judge specification.
*Acceptance.* A PR with a test-only export but no other finding has a passing API report job; the judge's own
check is the one that can block, through its gate.

### 5.6 CI and delivery (I)

**I-1 Corpus job in this repository.** On every PR, a job analyses both pinned corpora with the built tool,
writes one report per package, and fails on: an untyped failure, a package omitted, non-identical output
between two runs, or a `complete` report whose entry-point count differs from the manifest. It uploads the
run summary (package count, entry-point count, partial list, phase times) as an artifact.
*Acceptance.* The job is green on the PR head; the artifact's counts match C-1; a fixture package with an
unsupported construct fails the job with its file and construct, so the job cannot pass by skipping it.

**I-2 PR job in the private consumer repository.** On a pull request, a job selects the affected packages
(the workspace's affected-package selection, not a hand-written list), analyses each at the PR head and at the
PR base, and publishes one sticky PR comment (updated, never duplicated) plus one JSON artifact per affected
package. A package that the PR did not touch is not analysed. The job's summary names analysed, skipped and
partial packages and its wall time.
*Acceptance.* A PR touching three packages produces three JSON artifacts and one comment; a second push
updates the same comment; a PR touching only documentation produces a comment saying no package is affected.

**I-3 Publication channel.** The comment is written with the workflow's `GITHUB_TOKEN` (`contents: read`,
`pull-requests: write`); no new secret and no App key is added. The JSON artifacts are attached to the
workflow run and named by package and head SHA.
*Acceptance.* The job runs on a branch PR with no secret configured; the comment and artifacts are visible
on the PR; the artifact names contain the package and the head SHA.

**I-4 Budget and failure semantics.** For a PR touching at most three packages the report job completes in at
most two minutes on the self-hosted runner; the corpus job completes in at most ten minutes. A tool failure
publishes a comment naming the package and the reason; the judge treats a missing report as no evidence
(`Unclear`), never as "no change".
*Acceptance.* The wall times are in the job summary; a forced tool failure produces the failure comment; the
judge run on such a PR records `Unclear` for the export rule, not a pass.

**I-5 No new required check until its consumer exists.** The report job is not added to the required checks
of either repository by this spec. The required-check decision belongs to the review judge's own specification
and the repository's rulesets.
*Acceptance.* The branch protection and Mergify configuration are unchanged by this spec's PRs.

### 5.7 Performance and the state of the art (P)

**P-1 Benchmark against the oracle.** A committed benchmark runs the built tool and
`@microsoft/api-extractor` 7.59.4 end to end on the same corpus: cold and warm, source discovery through
report. The corpus is the public package monorepo's workspace packages that upstream can analyse; a package
upstream refuses is listed and excluded from the ratio, not silently dropped. It publishes wall clock per
package and total, plus the phase breakdown. The target is at least 10x the oracle; if it is not met, the
report names the measured ratio and the phase that stops it.
*Acceptance.* The benchmark runs in CI on the PR head; its JSON and Markdown records the corpus SHAs, tool
versions, host and numbers; the total ratio is at least 10x or the ceiling is stated with the phase; the
excluded packages and the reasons are listed.

**P-2 The fast path never type-checks.** A package is on the fast path only when its entry sources and the
sources they reach emit isolated declarations without a diagnostic; the route is recorded in the report. A
package on the fallback names the diagnostics that routed it.
*Acceptance.* The corpus run reports fast-path and fallback counts; a fast-path package's run invokes no
TypeScript checker (asserted by the absence of the compiler service in the run trace); a fallback package
names its diagnostic.

**P-3 TypeScript 7.1 adapter.** The compiler adapter is behind the emitter port. When TypeScript 7.1's API
(`typescript/sync`, `typescript/async`, `typescript/fs`, `typescript/ast`) is available, it slots in behind
the same port with no model schema change and no report format change; until then the TS 7.0.2 process
adapter runs.
*Acceptance.* An adapter conformance test runs the same package through the process adapter and an API-shaped
double and produces equal models; the model schema version is unchanged by the adapter choice.

**P-4 Semantic conformance with the oracle.** A differential lane compares this tool's model to
`@microsoft/api-extractor` 7.59.4's `.api.json` on a curated fixture corpus: entry points, export names,
kinds and normalised signatures. A mismatch is fixed or recorded as a deliberate difference with its evidence
and its Effect-aware reason. No byte comparison of `.api.md` is a gate.
*Acceptance.* The lane runs on the PR head; the fixture corpus covers subpaths, `export * as`, external
re-exports, `declare global`, overloads and dual APIs; every recorded difference names its fixture and reason.

**P-5 Committed profile.** The phase profile on both corpora records discovery, emit (fast and fallback),
parse, model build, messages, importer index and report render. The fast-path emitter choice remains the one
the profile supports.
*Acceptance.* The profile is reproducible from its harness, names both corpus SHAs and the host, and includes
the new phases.

### 5.8 Determinism, provenance and idiom (Q)

**Q-1 Effect-native.** Every wire boundary is an Effect Schema; decisions are pure functions over decoded
values; the verdict remains an effect-cell workflow and cell; no mutable shared state, `let`, or class
hierarchy is introduced. Tests import the package through its public specifier.
*Acceptance.* No `let` in `src`; schema laws and decision properties run on the production schemas; the
package's public surface is the namespaces its single `mod.ts` barrel exports today.

**Q-2 One barrel.** The package exports only `.` with one `mod.ts` namespace barrel; no subpath export is
added for tests or internals.
*Acceptance.* `package.json` has the same single `.` export (plus `./package.json`); tests import the package
name.

**Q-3 No locale APIs.** No `localeCompare`, `toLocale*` or `Intl` in `src`; ordering is `Order.String` and
canonical key order.
*Acceptance.* The existing grep gate prints nothing for the new modules.

**Q-4 Licence and provenance.** The repository stays MIT with Microsoft's notice; every file derived from
`microsoft/rushstack` or a systemfsoftware PR carries its origin header. `@microsoft/api-extractor` is a
devDependency of the conformance lane only.
*Acceptance.* The conformance lane is the only importer of the upstream package; no report code is copied
without a header.

**Q-5 Outputs only through the canonical writer.** Every JSON output, including the change report and the
benchmark record, goes through `canonicalJson`; no ad-hoc `JSON.stringify` reaches a file.
*Acceptance.* The serialiser gate covers the new outputs; a report with unordered keys is impossible by
construction.

## 6. Acceptance examples

**AE1 — Test-only internal surface.** Given a private application package that adds
`"imports": { "#internal/*": "./src/*" }` and tests that import `#internal/queue-writer.service`, when the
change report is produced, then the internal-surface delta names the map entry and the test files; the public
bump is `none`; the judge, reading the report, answers its test-on-internals question yes with those lines.

**AE2 — A real public API.** Given a package that adds `./public-api` to its `exports` map and a production
module in another package imports it, when the change report is produced, then the report shows one added
entry point and one added export, the importer is classified production, the bump is minor, and the judge
answers its export-smuggling question no.

**AE3 — Effect error channel.** Given a function returning `Effect<User, NotFound>` that now returns
`Effect<User, NotFound | Timeout>`, when the change report is produced, then it carries the before/after
signatures, position `out`, channel `E`, bump major and reason `E_WIDENED`; the changeset check requires
major.

**AE4 — Barrel namespace.** Given a fixture package whose `mod.ts` is fourteen `export * as X` statements,
when the report is produced, then each namespace appears with its members and each member has an anchor; a
member added inside `NamespaceA` appears in the change report under `NamespaceA`, not as a top-level export.

**AE5 — Private source package.** Given a private fixture package that exports `./src/*.ts`, when the report
is produced from a clean checkout with no `dist/`, then it reports the nine entry points its manifest declares
and needs no build.

**AE6 — Determinism.** When the same two models are rendered under `LC_ALL=C`, `LC_ALL=tr_TR.UTF-8` and a
different time zone and working directory, then the report and change report bytes are identical.

**AE7 — Under-declared changeset.** Given AE3's change and a changeset declaring `minor`, when the check runs,
then it fails naming the package, `minor`, `major` and `E_WIDENED` with its anchor, and the PR comment shows
the same finding.

**AE8 — No change.** Given a package whose public surface is unchanged, when the change report is produced,
then `bump` is `none` and `changes` is empty with `coverage: complete`; a package that failed to analyse is a
typed error or `coverage: partial`, not an empty change report.

## 7. Out of scope

- Byte-identical `.api.md` output against `@microsoft/api-extractor`, and the port of its sort key.
- A bundled `.d.ts` build artifact (`tsdown`/`rolldown` own build output), and an `.api.json` emitter for
  api-documenter.
- SARIF, GitHub code-scanning alerts, and a web UI.
- Judging whether an export is useful or smuggled; that is the review judge's, under its own specification.
- API changes in dependencies outside the workspace; only the workspace's own packages are modelled.
- npm publishing; releases remain git tags and GitHub Releases.
- Per-PR mutation testing; mutation stays a `main`-only control.
- A new required check, branch-protection change or Mergify change.

## 8. Supersessions and starting point

- This spec supersedes the old plan's **R8** (byte-identical reports), **R9** (byte differential lane),
  **U8** (the upstream-parity renderer), **U9** (benchmark as a separate PR) and **U10** (CLI, bump check and
  journey as a later PR) as requirements. It keeps R1-R7, R10-R23 except where a requirement above replaces
  them.
- **PR #7 is held, and the lead ruled on 2026-10-24: keep it and merge it only after a non-author review that
  cites evidence.** Its extensions — anchors, release tags, ambient declarations, external re-exports — land
  as separate small PRs, never by growing #7. It stays unmerged until that review. Rebuilding was considered
  and rejected: its emitter-port and front-end shape is the one the research supports, and a rebuild would
  delay the judge's first deliverable without a shape gain. If the review finds the shape wrong, it is
  replaced then, and no requirement above changes, because every requirement is on behaviour.
- The six-PR sequencing is no longer the plan of record. The design and tasks phases re-cut the remaining
  work into units that each ship independently on trunk.

## 9. Decisions taken by this spec (accepted 2026-10-24)

- **K1 — Upstream compatibility.** The tool's own model, report and change report are the product; upstream
  `.api.json` is a semantic oracle only, and byte-identical `.api.md` is deleted. Chosen because the measured
  printer divergence between TypeScript 7 and 5.9.3 (126/585 files) makes byte parity a compiler-line
  commitment with no consumer in this spec, while the semantic oracle still catches real model errors.
- **K2 — Where the judge reads the report.** CI publishes one sticky PR comment with the bounded Markdown and
  one JSON artifact per affected package; the write-time agent layer runs the same command locally. Chosen
  because the judge's GitHub adapter already reads PR comments and the comment is the only channel that
  reaches the judge without a new service, while the artifact keeps the full JSON for machines.
- **K3 — The judge's input is evidence, not a gate.** The tool reports importers and internal-surface deltas;
  it has no smuggling rule and no threshold. Chosen because the review-judge specification puts the judgement
  in the judge model and withdraws deterministic agent-gaming checks.
- **K4 — PR #7.** Lead ruling, 2026-10-24: keep PR #7 and merge it only after a non-author review that cites
  evidence; its extensions (anchors, release tags, ambient declarations, external re-exports) land as separate
  small PRs, never by growing #7. It stays unmerged until that review. Rebuilding was rejected for the reasons
  in §8; if the review finds the shape wrong, it is replaced then, and no requirement changes.

## 10. Sources

Checked 2026-10-24 unless a date says otherwise.

- `https://registry.npmjs.org/@microsoft/api-extractor`, `.../@microsoft/api-extractor-model`,
  `.../@microsoft/api-documenter`, `.../typescript`, `.../oxc-transform`, `.../rolldown-plugin-dts`,
  `.../tsdown`, `.../typedoc`, `.../@arethetypeswrong/cli`, `.../@api-extractor-tools/change-detector`,
  `.../@clerk/break-check`, `.../knip`, `.../publint` — versions, publish dates and licences.
- `https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/` — TypeScript 7 has no stable
  programmatic API; TypeScript 6 remains for tools that need the checker.
- `https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/` — TypeScript 7.1's API entry
  points (`typescript/sync`, `typescript/async`, `typescript/fs`, `typescript/ast`), RC and final timing.
- `https://github.com/obi1kenobi/cargo-semver-checks` — rustdoc JSON plus Trustfall declarative lints; the
  model-and-rules shape this spec keeps.
- `docs/profiles/2026-10-13-front-end-phases.md` and its JSON on PR #7 — the 40-package, 585-file profile,
  the phase times and the 126/585 printing divergence.
- `packages/api-extractor/src/model/api-model.schema.ts`, `src/rules/corpus.v1.json`,
  `src/diff/change.schema.ts`, `src/verdict.schema.ts` at PR #7 / `origin/main` — the model version, the 61
  rules and the change/finding shapes.
- `gh pr view 7` on this repository — head `3deadf9c`, +18,820/−43, 57 files, mergeable, review required,
  updated 2026-10-14.
- The public package monorepo at `f36e00fba` — 48 packages, 46 with `exports`, 119 subpaths, measured from
  the manifests.
- The review-judge specification, held outside this repository — its rule families (export smuggling, tests
  on internals), its `export_delta` and `test_imports` fact names, and its rule that facts are evidence, never
  regex gates.
- A private consumer repository, pinned by SHA in the corpus job's configuration and not named here —
  source-exporting private packages and an application package with an `imports` map and no `exports` map.
- The two survey outputs: `google/gemini-3.8-flash` through OpenRouter and Grok through grok.com, both run
  on 2026-10-24; their architecture opinions informed §3.2 and were not used as facts.
