# api-extractor-sota: design

Date: 2026-10-24. Type: feature. Requirements: `requirements.md` in this directory.
Status: draft for review. The first deliverable is the change report the review judge reads (requirements
G1, J-0). PR #7 is held and, per requirement K4, merges only after a non-author review that cites evidence;
its extensions land as separate small PRs, never by growing #7.

## 1. Scope, baseline and constraints

- This design implements `requirements.md`; the requirement IDs below are the authority.
- The baseline is PR #7 after its review. Its `FrontEnd.analyse`, route, emitter port, isolated fast path,
  TypeScript 7 process fallback, model builder and message resolver stay. The design extends them with
  anchors, release tags, manifest facts, external re-exports and ambient declarations in separate PRs.
- The repository is public. Every fixture, example, report and test uses neutral names (`@example/library`,
  `#internal/*`, `NamespaceA`), repository-relative paths and no private repository, package or person.
- The package stays Effect-native and canonical: Effect Schema at every wire boundary, pure decisions,
  `canonicalJson` for every JSON output, `Order.String` ordering, no `Intl`/`localeCompare`/`toLocale*`,
  one `mod.ts` barrel and no subpath exports.
- There is no new runtime service. The tool runs as a CLI in CI and in the write-time agent layer, against
  local checkouts; the judge reads a published artifact.
- Model versions: **v3** adds anchors, release tags, the manifest facts, messages and coverage (first
  deliverable). **v4** adds external re-exports and ambient declarations (corpus completeness). Each version
  bump lands in its own PR and updates `API_MODEL_SCHEMA_VERSION`.

## 2. Architecture

```text
package.json + source
        │  readPackage (export-map target, condition, imports map)
        ▼
   PackageSource ──────────────────────────────────────────────┐
        │                                                     │
        ▼                                                     │
  FrontEnd.analyse                                            │
    ├─ emitter port: oxc isolated (fast) | TypeScript 7 (fallback)
    ├─ declaration graph (entry points, re-exports, ambient)
    ├─ source index (anchors, release tags, @stability)
    ├─ model builder + message resolver + coverage
    ▼
  ApiModel v3/v4  ──────────────┬──────────────────────────────┐
        │                       │                              │
        ▼                       ▼                              ▼
  report renderer         diffModels(base, head)         import index (head workspace)
  (canonical JSON +       (existing diff + anchors)     (who imports each new export)
   bounded Markdown)            │
                                ▼
                        ChangeReport (canonical JSON + bounded Markdown)
                                │
                                ▼
                        CLI / CI / sticky PR comment / judge
```

The model is the only contract between analysis and presentation. The report renderer and the diff read
decoded models, never source. The importer index is a separate fact producer over the head workspace; it
never changes the public surface.

### 2.1 Module map

| Module | Responsibility |
|---|---|
| `src/model/api-model.schema.ts` | `ApiModel` v3/v4: package surface, entry points, items, anchors, tags, augmentations, messages, coverage. |
| `src/model/type-expr.schema.ts` | Existing structural type AST; unchanged except item metadata. |
| `src/model/message.schema.ts` | `AnalysisMessage` moved beside the model it is part of; re-exported by `FrontEnd` for compatibility. |
| `src/model/serialise.ts`, `canonical-json.schema.ts` | Existing canonical writer; all new outputs use it. |
| `src/report/schema.ts` | `ApiReport` wire schema (`reportVersion` plus the model). |
| `src/report/print.ts` | Pure declaration-style printer over the model (`printType`, `printSignature`, `printItem`, `printAugmentation`). |
| `src/report/render.ts` | Bounded Markdown renderer and truncation; no source access. |
| `src/change/change-report.schema.ts` | `ChangeReport` wire schema and pure per-change detail mapping. |
| `src/change/import-index.ts` | Workspace import index over `oxc-parser`; importer classification. |
| `src/change/diff-package.ts` | Two-revision orchestration: worktrees, analysis, diff, importer join. |
| `src/change/render.ts`, `pr-comment.ts` | Bounded per-package and per-PR Markdown, marker and update key. |
| `src/front-end/source-index.ts` | Source-derived anchors, release tags, `@stability` and ambient positions. |
| `src/front-end/read-package.ts`, `package-source.schema.ts` | Manifest decode, export/import targets, conditions, patterns. |
| `src/front-end/build-model.ts`, `declaration-graph.ts` | Existing builder/graph, extended for anchors and v4 external/ambient. |
| `apps/api-extractor-cli` | New CLI app: `report`, `diff`, `corpus`, `check-bump`. |
| `apps/api-extractor-bench` | Benchmark against `@microsoft/api-extractor` 7.59.4. |
| `apps/api-extractor-conformance` | Semantic comparison with the upstream `.api.json` model. |
| `apps/api-extractor-profile` | Existing profile harness, extended with report/import/change phases. |
| `apps/api-extractor-e2e` | Existing cross-process determinism and public-surface e2e. |
| `.github/workflows/api-report.yml` | Reusable consumer workflow: affected packages, comment, artifacts. |

## 3. The model (v3 and v4)

### 3.1 v3 additions

```ts
export type Anchor = { readonly file: string; readonly line: number }

export const ReleaseTag = Schema.Literals(['public', 'beta', 'alpha', 'internal', 'untagged'])
export type ReleaseTag = typeof ReleaseTag.Type

type ItemMeta = {
  readonly anchor: Anchor | null          // repository-relative source file, 1-based line
  readonly releaseTag: ReleaseTag         // 'untagged' when no TSDoc tag is present
  readonly stability: string | null       // TSDoc @stability value, when present
}

export type ManifestEntry = {
  readonly key: string                    // '.', './sub', '#internal/*'
  readonly target: string | null          // resolved target path, null when excluded
  readonly condition: string | null       // the condition that selected target
}

export type EntryPoint = {
  readonly path: string
  readonly target: { readonly key: string; readonly condition: string | null; readonly path: string }
  readonly items: ReadonlyArray<ApiItem>
  readonly locals: ReadonlyArray<TypeAliasItem>
}

export type PackageSurface = {
  readonly name: string
  readonly version: string
  readonly exports: ReadonlyArray<ManifestEntry>
  readonly imports: ReadonlyArray<ManifestEntry>
}

export type CoverageReason = {
  readonly kind: 'unsupported' | 'unresolved' | 'unmapped-anchor' | 'pattern-empty' | 'parse' | 'external-star'
  readonly file?: string
  readonly construct?: string
  readonly detail: string
}

export type ApiModel = {
  readonly schemaVersion: 3
  readonly producer: { readonly engine: string; readonly declarations: string }
  readonly package: PackageSurface
  readonly anchorBase: 'workspace' | 'package'
  readonly entryPoints: ReadonlyArray<EntryPoint>
  readonly messages: ReadonlyArray<AnalysisMessage>
  readonly coverage: { readonly complete: boolean; readonly reasons: ReadonlyArray<CoverageReason> }
}
```

Every item kind (`function`, `variable`, `typeAlias`, `interface`, `class`, `enum`, `namespace`) gains
`ItemMeta`. The item metadata is part of the wire: a model without an `anchor` key does not decode, which is
why the version moves to 3.

`AnalysisMessage` (moved to `src/model/message.schema.ts`) gains `anchor: Anchor | null`; the message resolver
attaches it from the source index, so a message and the symbol it names carry the same anchor.

`sortModel` gains deterministic orders: messages by `(messageId, entryPoint, item, symbol)`, coverage reasons
by `(kind, file, construct, detail)`, manifest entries by `key`, and entry points remain by `path`. Item order
stays by name, kind and canonical content. `decodeApiModel` and `encodeApiModel` are unchanged; the decoder
refuses any `schemaVersion` other than 3.

### 3.2 v4 additions (separate PR)

```ts
export type ExternalItem = {
  readonly kind: 'external'
  readonly name: string
  readonly module: string
  readonly importedName: string | null
} & ItemMeta

export type ExternalStar = { readonly module: string; readonly anchor: Anchor | null }

export type Augmentation = {
  readonly kind: 'global' | 'module'
  readonly module: string | null          // null for `declare global`
  readonly items: ReadonlyArray<ApiItem>
  readonly anchor: Anchor | null
} & ItemMeta
```

`EntryPoint` gains `externalStars: ReadonlyArray<ExternalStar>`; `ApiModel` gains
`augmentations: ReadonlyArray<Augmentation>`. External items are compared by `(module, name)`; augmentations
by `(kind, module)` and then their items. A removed external star is a major change (it can remove names);
an added one is minor or major per the corpus's `EXPORT_ADDED`/`UNCLASSIFIED_CHANGE` path, but the coverage
reason `external-star` marks enumeration partial. `API_MODEL_SCHEMA_VERSION` moves to 4.

### 3.3 Printing

`src/report/print.ts` is pure over the model:

- `printType(TypeExpr)`: keyword, literal, reference with module and arguments, union (members in canonical
  key order), intersection, array, tuple, function, object, and `opaque` text verbatim. No locale API.
- `printSignature(Signature)`: type parameters, parameters with `optional`/`rest`, return type.
- `printItem(ApiItem)`: one declaration per overload; namespaces recurse; external items print
  `export { name } from 'module'`; external stars print `export * from 'module'`.
- `printAugmentation(Augmentation)`: `declare global { ... }` or `declare module 'x' { ... }`.

The printer is deterministic: it sorts union members by `canonicalKey`, prints object members in model order,
and never prints an absolute path or a timestamp.

### 3.4 Public surface

`ApiModel` keeps exporting the schemas, `sortModel`, `decodeApiModel` and `encodeApiModel`. The printer stays
internal to the package (`src/report/print.ts`) so the public API does not grow for a presentation concern.
`FrontEnd.AnalysisMessage` is re-exported from the model module for compatibility.

## 4. Front-end

### 4.1 Manifest targets and conditions

The PR #7 reader accepts only the `@systemfsoftware/source` condition. The private consumer repository and
many public packages export a plain string or the `types` condition, so `readPackage` gains one target
resolution:

```ts
export const targetPathOf = (target: ExportTarget, preferred: string): Option.Option<{ path: string; condition: string | null }>
```

Resolution order for a `Conditions` target: the requested condition (CLI `--condition`, default
`@systemfsoftware/source`), then `types`, then `import`, then `default`, then the first string target in
code-unit key order; for a `Path` target, the path itself with `condition: null`; for `Fallbacks`, the first
target that yields a path; `Excluded` yields none. A manifest whose `exports` is a single string is treated as
`{ ".": <string> }`; the current reader returns no entry point for that shape. A resolved target must be a TypeScript source or
declaration file (`.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`); anything else is a `NoSourceEntry` refusal that
names the export key and target. `PackageSource` keeps `workspaceRoot` and gains `manifest: PackageSurface`.

`PackageManifest` gains `imports` (the same recursive target shape). `readPackage` resolves every `imports`
entry with the same function and records it in `PackageSurface.imports`. An imports entry is internal
surface, never an entry point. A package with no `exports` but with `imports` analyses to zero entry points
and complete coverage for the declared surface.

Pattern exports (`./*`) keep PR #7's deterministic walk and directory budget. Each resolved subpath records
the chosen condition and target in `EntryPoint.target`.

### 4.2 Source index: anchors, tags and stability

PR #7's messages already parse TSDoc release tags from source comments. The design promotes that data into
the model:

```ts
export type SourceDeclaration = {
  readonly file: string                  // repository-relative
  readonly line: number                  // 1-based
  readonly name: string
  readonly kind: 'function' | 'variable' | 'typeAlias' | 'interface' | 'class' | 'enum' | 'namespace'
  readonly releaseTag: ReleaseTag
  readonly stability: string | null
}

export type SourceIndex = {
  readonly declarationsOf: (file: string) => ReadonlyArray<SourceDeclaration>
  readonly reExportsOf: (file: string) => ReadonlyArray<SourceReExport>
  readonly ambientOf: (file: string) => ReadonlyArray<SourceAmbient>
}
```

`source-index.ts` parses each source file the emitter read with `oxc-parser`'s `parseSync`, records every
top-level declaration's `(name, kind, start)`, and computes the line by counting newlines in the source
text (a code-unit scan, no locale). It reads leading TSDoc comments with the configured
`@microsoft/tsdoc` parser, reusing the `leadingCommentOf` and `tagIn` logic from `resolve-messages.ts`
(moved into a shared `tsdoc.ts`). A `@stability` custom tag is declared on the parser configuration and its
text is stored in `stability`.

`Declarations` (the internal emitter output) gains `sources: ReadonlyArray<{ path: string; text: string }>`,
so the index never re-reads the filesystem and both emitters produce the same input. The builder receives
the index in `ModelOfGraphRequest` and attaches `anchor`, `releaseTag` and `stability` to every item:

- `anchorOf(originSourceFile, name, kind)`: the first source declaration in that file with the same kind and
  name; then the first with the same name; otherwise `null`. The origin source file comes from the
  declaration graph's resolved symbol (the file that declares the symbol), so a re-exported symbol anchors at
  its declaration.
- `releaseTag`: the source declaration's tag, or `untagged`.
- `stability`: the source declaration's `@stability` value, or `null`.
- A `null` anchor does not fail the analysis; it adds an `unmapped-anchor` coverage reason for the entry point
  and the symbol is still printed. The judge treats an unanchored symbol as unanchored, per requirement R-4.

The index is also the source for `ae-missing-release-tag`, so messages and item tags cannot disagree.

### 4.3 Analysis composition

`FrontEnd.analyse(source)` returns `{ route, model }`; the model now carries `messages` and `coverage`:

1. route to the isolated or compiler emitter (unchanged);
2. build the declaration graph (unchanged);
3. build the source index over `Declarations.sources`;
4. build the model with item metadata, augmentations (v4) and coverage;
5. resolve messages and attach them to the model.

`FrontEnd.buildModel(declarations)` remains for tests and the profile; it builds the model with an empty
source index (anchors `null`, coverage reason `unmapped-anchor`) and the messages it can derive from the
graph. `FrontEnd.resolveMessages(declarations)` stays exported and is the same function `analyse` uses.

### 4.4 External re-exports (v4)

`build-model.ts` currently refuses `symbol.kind === 'external'`. In v4 it returns an `ExternalItem` instead,
and `declaration-graph.ts` records an external star for `export * from 'pkg'`. The item carries the module
specifier, the exported name and the imported name when the re-export renames. The report prints the
re-export statement, the change report treats an added/removed external item as an export addition/removal,
and coverage records `external-star` for a star re-export whose names cannot be enumerated. The existing
`UnsupportedDeclaration` refusal stays for constructs that are still unsupported; these two are no longer
among them.

### 4.5 Ambient declarations (v4)

`declaration-graph.ts` records `declare global { ... }` and `declare module 'x' { ... }` blocks and their
declarations instead of refusing them. The builder turns each block into an `Augmentation`; the items inside
are built with the same item builder, anchored at the ambient declaration. Augmentations are not entry
points: they are a top-level model array and the report prints them in their own section. The diff compares
them by `(kind, module)` and then by item, so an added or removed global member is a change with the existing
member rules.

### 4.6 Coverage and refusals

`coverage.complete` is false when any of these is recorded: an unsupported declaration, an unresolved entry
point, a pattern that resolves no entries, a source file that cannot be parsed, or an anchor that cannot be
mapped. `analysis-message.schema.ts`'s ids stay; `coverage` is separate from messages because it describes the
analysis, not the package's API. A package-level refusal (`NoSourceEntry`, `ManifestRejected`,
`CompilerRejected`, `NotIsolated` after the fallback) fails the analysis; the CLI turns it into a typed
artifact (`{ status: 'refused', reason }`) for the corpus summary, never an empty report.

### 4.7 Emitter port

The existing `IsolatedEmitter` and `CompilerEmitter` ports stay. The isolated path calls
`oxc-transform`'s `isolatedDeclarationSync`; the fallback calls the TypeScript 7 process with the derived
tsconfig. Anchors do not use declaration maps: the source index supplies them, so both routes produce the
same anchor for the same package. TypeScript 7.1's API is a third adapter behind the same port (§10.3).

## 5. The API report

### 5.1 Wire shape

```ts
export const ApiReport = Schema.Struct({
  reportVersion: Schema.Literal(1),
  model: ApiModel,
})
```

The JSON report is the model plus a report version; the Markdown is a view rendered from that JSON. A report
decoded at a different `reportVersion` is refused by name. The CLI writes
`<package>.api-report.json` and `<package>.api-report.md`, where `<package>` is the package name with `/`
replaced by `--` (no absolute paths in a filename).

### 5.2 Renderer

`renderReport(report, options)` is a pure function returning `{ markdown, truncated, shown, total }`:

```ts
export type ReportOptions = { readonly maxCharacters: number } // default 16_000
```

The Markdown structure is fixed:

````text
# @example/library 1.2.3 — public API
producer: @systemfsoftware/api-extractor <version> / oxc-transform@<version>
model: 3  report: 1  coverage: complete

## Entry point "."
target: ./src/mod.ts (condition @systemfsoftware/source)

```ts
export namespace NamespaceA {
  export function list(...): Effect<ReadonlyArray<Item>, ItemError, never>   src/namespace-a/mod.ts:12
}
```

## Entry point "./schema"
...

## Internal
export function parseWire(...)   src/wire.ts:40   // @internal

## Global and module augmentations
declare global { ... }   src/global.d.ts:1

## Analysis messages
ae-missing-release-tag: NamespaceA.list   src/namespace-a/mod.ts:12

## Coverage
complete
````

- Every symbol line ends with its anchor; an unanchored symbol prints `anchor: none`.
- Each entry point also prints its non-exported `locals` (the type aliases public signatures reference) in a
  `Locals` block; they are not public exports, but a reader needs them to read the signatures.
- The internal section lists `@internal` exports; they never appear under an entry point.
- Augmentations and messages appear only when present; coverage prints `complete` or each reason.
- The renderer uses `print.ts`; it never reads source, the clock or the environment.
- Truncation: the renderer keeps every heading and every entry point's first symbols until the cap; it then
  appends `... truncated: <shown> of <total> symbols; full JSON: <path>`. The path is the CLI-provided
  relative path, never an absolute one. Truncation is deterministic: same input and cap, same output.

### 5.3 Canonical output and determinism

The JSON goes through `canonicalJson`; the Markdown is built from string parts in model order. Neither output
contains a timestamp, host name, absolute path, locale-formatted number or array order that depends on
input order. The report is added to the existing cross-process determinism proof and to the cross-host digest.

## 6. The change report

### 6.1 Wire shape

```ts
export const ChangeReport = Schema.Struct({
  changeReportVersion: Schema.Literal(1),
  package: Schema.Struct({ name: Schema.String, version: Schema.String }),
  base: Revision,
  head: Revision,
  modelSchemaVersion: Schema.Int,
  engine: Schema.String,
  corpusVersion: Schema.String,
  bump: Bump,
  findings: Findings,
  changes: Schema.Array(ChangeDetail),
  exportsDelta: Schema.Array(ManifestDelta),
  importsDelta: Schema.Array(ImportsDelta),
  importers: Schema.Array(ImporterGroup),
  messages: Schema.Array(AnalysisMessage),
  coverage: Coverage,
})

export type Revision = {
  readonly sha: string
  readonly absent: boolean
  readonly entryPoints: ReadonlyArray<string>
  readonly exportCount: number
  readonly dependencies: 'head' | 'base' | 'absent' // provenance of the node_modules used
}

export type ChangeDetail = {
  readonly surface: 'public' | 'internal'
  readonly kind: ChangeKind
  readonly location: string
  readonly path: ReadonlyArray<string | number> // structured lookup into the models
  readonly position: Position
  readonly channel: string | null
  readonly direction: Direction | null
  readonly ruleId: string
  readonly reasonCode: string
  readonly bump: Bump
  readonly anchor: Anchor | null
  readonly before: string | null // printed signature, null when added
  readonly after: string | null  // printed signature, null when removed
}

export type ManifestDelta = {
  readonly key: string
  readonly action: 'added' | 'removed' | 'retargeted'
  readonly base: ManifestEntry | null
  readonly head: ManifestEntry | null
}

export type Importer = {
  readonly package: string
  readonly file: string
  readonly specifier: string
  readonly names: ReadonlyArray<string> // ['*'] for a namespace or star import
  readonly usage: 'production' | 'test'
  readonly typeOnly: boolean
  readonly self: boolean
}

export type ImporterGroup = {
  readonly symbol: string
  readonly entryPoint: string
  readonly importers: ReadonlyArray<Importer>
  readonly counts: { readonly production: number; readonly test: number; readonly typeOnly: number; readonly self: number }
}
```

### 6.2 Changes and signatures

`detailChanges(corpus, changes, before, after)` maps each `Change` to a `ChangeDetail`:

- `classify(corpus, change)` (existing) supplies `ruleId`, `reasonCode` and `bump`.
- `path` is new on `Change`: the diff records a structured path as it walks the models, alongside the existing
  display `location`. `lookupSignature(model, path)` uses it to print the before and after declaration with
  `print.ts`; an unresolvable path prints `null`.
- `anchor` is new on `Change`: the after item's anchor, or the before item's for a removal. A change with no
  anchor is still listed; the judge sees it as unanchored.
- `messages` are the head model's messages, sorted. They are analysis output, not changes; the diff ignores
  `messages` and `coverage`.

An item tagged `@internal` is not part of the public surface: `diffModels` skips it for findings and bump, and
the change report lists its changes with `surface: 'internal'` and `bump: 'none'`. An internal change is
evidence for the judge, not a public semver change; the report's internal section prints the same items.

`diffModels` accepts only two models of the same `schemaVersion`; the CLI fails with `SurfaceRejected` naming
both versions otherwise, because a cross-version diff would compare different shapes.

### 6.3 Importers

`src/change/import-index.ts` builds an index of the head workspace:

1. **Packages.** Run `pnpm ls --recursive --json --depth -1` in the repository root with `ChildProcessSpawner`
   and read the package roots. If the command fails, fall back to the root `pnpm-workspace.yaml` `packages`
   globs expanded by `FileSystem`; if neither yields a package list, the change report records a `parse`
   coverage reason and lists no importers (never "none").
2. **Files.** Walk each package root for `.ts`, `.tsx`, `.mts` and `.cts`, skipping `node_modules`, `dist`,
   `.git` and the report output directory.
3. **Parse.** `oxc-parser`'s `parseSync`; record static imports, `export ... from`, literal dynamic imports
   and literal `require`; record `import type` and `import { type X }` as `typeOnly`; record namespace imports
   and star re-exports as `['*']`.
4. **Resolve.** A specifier resolves to a workspace package when it equals a package name or starts with
   `<name>/`; the longest matching name wins. Relative and external specifiers are ignored. The entry point is
   the package name plus the subpath after the package name (`''` for `.`).
5. **Classify.** `usage: 'test'` when the file path is under a `tests/`, `__tests__/` or `test/` directory or
   its name matches `.test.` or `.spec.`; otherwise `production`. `self` when the file's package is the
   analysed package.
6. **Join.** For an added export at `(package, entryPoint, symbol)`, importers are files whose resolved
   `(package, entryPoint)` matches and whose names contain `symbol` or `*`. The `counts` are the number of
   distinct importers in each class. An export with no importer gets `[]`.
7. **Internal specifiers.** The index also records `#...` specifiers inside the package and resolves them
   against the package's `imports` map, so §6.4 lists the files that import an added or widened `#internal/*`
   entry.

The index reports `parsed`, `skipped` and `unresolved` counts in the coverage reasons when any file cannot be
parsed or a workspace package cannot be listed. It parses source; it never matches source text with a regex.

### 6.4 Map deltas

`exportsDelta` compares the base and head `PackageSurface.exports` by key: added, removed, or retargeted
(target path or condition changed). `importsDelta` compares the base and head `imports` by key and lists the
files that import each added or widened `#x/*` specifier. An imports-map addition alone does not change the
public bump; it is evidence for the judge's test-on-internals rule.

### 6.5 No verdict on smuggling

The change report has no `smuggled` field, no threshold and no rule that fails on an empty production
importer list. `importers: []` is a fact; the judge decides. The tool's own rule corpus is unchanged and has
no smuggling rule.

### 6.6 No change versus no report

- No public change: `bump: "none"`, `changes: []`, `coverage.complete: true`, and both revisions present.
- Refusal: the CLI writes a typed artifact `{ status: "refused", package, reason }` (or exits 2 when no
  artifact is requested); the PR comment prints `report unavailable: <reason>`.
- The consumer can distinguish the two by `status`/`coverage`; an empty change list is never used for a
  refusal.

### 6.7 Two revisions in one command

`diff-package.ts` orchestrates:

1. `git rev-parse <baseRef>` and `<headRef>` (or use the current working tree for head when it is checked
   out).
2. Create a detached base worktree with `git worktree add --detach <tmp> <baseSha>`. Head gets a second
   worktree only when it is not the working tree.
3. For every workspace package in the base worktree that has no `node_modules`, symlink the head checkout's
   corresponding `node_modules`; record `dependencies: "head"`. The base worktree's own dependencies, when
   present, are used and recorded as `base`.
4. `FrontEnd.analyse` the base package and the head package with the same tool version; require equal model
   schema versions.
5. `diffModels`, `detailChanges`, the import index at head, the map deltas, the findings and the bump.
6. Remove the worktrees it created in a scope finalizer (`git worktree remove --force <tmp>`). The tool never
   runs `git clean`, `git reset`, `git stash` or `git worktree prune`; the worktrees are its own.

A package absent at base (a new package) sets `base.absent: true`; every head export is an addition and the
report says so.

### 6.8 PR comment

`renderPrComment(reports, options)` produces one bounded document (`maxCharacters: 48_000`):

```text
<!-- api-extractor-change-report head=<sha40> -->
## Public API change report — <n> package(s)

### @example/library — minor
Added ./public-api: 1 export, 1 production importer, 0 test importers
+ export function fetchPublic(...): Effect<...>   src/public-api.ts:12
  importers: alpha (src/use.ts) production

Internal surface: #internal/* added (3 test importers)
Coverage: complete
```

The marker starts with the fixed prefix `<!-- api-extractor-change-report`; the comment updater finds the
existing comment by that prefix and updates it, so a second push never duplicates the comment. The head SHA
inside the marker lets the judge select the comment for the current head. Truncation keeps each package's
heading and bump, lists the packages whose sections were shortened and points at the JSON artifacts.

## 7. CLI

### 7.1 App and packaging

A new private workspace app `apps/api-extractor-cli`:

- `package.json`: `name: "api-extractor-cli"`, `private: true`, `type: "module"`, `exports` only `"."`,
  `bin: { "api-extractor": "./dist/main.mjs" }`, scripts `build` (tsdown), `lint`, `typecheck`, `test`.
- `tsdown.config.ts` spreads the family `quietBuild`; `dts: false` for the CLI.
- `src/main.ts` is the Effect entry point with `NodeRuntime.runMain` and `NodeServices.layer`.
- The flake exposes the built app as `packages.api-extractor-cli`, so the write-time layer and the consumer
  workflow run a pinned build without a registry.

### 7.2 Commands

| Command | Behaviour |
|---|---|
| `api-extractor report --package <dir> [--workspace <dir>] [--condition <name>] [--out <dir>] [--stdout json\|markdown\|summary]` | Analyse one package and write the API report JSON and Markdown. |
| `api-extractor diff --repo <dir> --package <rel> --base <ref> [--head <ref>] [--out <dir>] [--stdout json\|markdown\|summary] [--comment <path>]` | Produce the change report, the Markdown view and the PR comment. |
| `api-extractor corpus --repo <dir> [--out <dir>] [--condition <name>] [--public-only]` | Report every workspace package, private ones included unless `--public-only`, and write a run summary. |
| `api-extractor affected --repo <dir> --base <ref> --head <ref>` | List the workspace packages whose files changed (for the CI job). |
| `api-extractor comment --reports <dir> --head <sha>` | Post or update the sticky PR comment using `GITHUB_TOKEN`. |
| `api-extractor check-bump --report <json> [--changesets <dir>] [--declared <pkg=bump>]` | Compare the API bump with the declared changeset bump. |

### 7.3 Write-time agent layer

When a lane changes a test file, a `package.json` `exports`/`imports` map, or a module reachable from an entry
point, the write-time layer runs:

```sh
api-extractor diff --repo <lane worktree> --package <changed package> \
  --base <pull-request base> --out <temporary directory>
```

and passes the change report JSON and Markdown to the judge model. The lane already holds the base ref; the
command creates only its own temporary base worktree and needs no network or service. It is the same command
CI runs for the same commit, so the layer and the PR reviewer read the same artifact.

Every command writes canonical JSON when asked for JSON; the default stdout is a short summary and all logs
go to stderr. No output contains an absolute path, a timestamp or a host name. Exit codes: `0` success (even
when coverage is partial, unless `--fail-partial` is set), `1` a check failed (bump, corpus refusal),
`2` an input or tool error, `3` a model/report version mismatch.

## 8. CI and the judge

### 8.1 Reusable consumer workflow

`.github/workflows/api-report.yml` is `workflow_call`:

```yaml
on:
  workflow_call:
    inputs:
      tool-ref: { type: string, required: true }   # full SHA in this public repository
      base-ref: { type: string, required: false }
      head-ref: { type: string, required: false }
      packages: { type: string, required: false }  # empty = affected (PR) or all (corpus)
      mode: { type: string, default: affected }    # affected | corpus
      comment: { type: boolean, default: true }
```

The caller grants `contents: read`, `pull-requests: write` and `actions: read`; there are no secrets. The job:

1. Checks out the consumer repository at the head SHA with full history (the base commit must be present).
2. Checks out this repository at `tool-ref` into `.api-extractor-tool`.
3. Builds the CLI from that checkout (`nix build .#api-extractor-cli` in the tool checkout, or the tool's
   dev shell), so the consumer needs no registry.
4. Selects packages: in `affected` mode, `api-extractor affected` unless `packages` is supplied; in `corpus`
   mode, every workspace package (or `packages`), via `api-extractor corpus`.
5. Runs `api-extractor diff` for each package at the base and head SHAs, writing `.api-reports/<pkg>/` (or
   `api-extractor corpus` into the same directory in corpus mode).
6. Uploads `api-reports-<headSha>`.
7. Runs `api-extractor check-bump` for each report with the changeset directory and records the result in the
   comment and the summary.
8. Runs `api-extractor comment` to post or update one sticky comment, when `comment` is true.
9. Writes a job summary: analysed, skipped, partial, wall time, and whether the two-minute budget was met.

A tool failure for a package still posts the comment with `report unavailable: <reason>` and fails the job
(red), but the job is not a required check (requirement I-5), so it cannot block a merge on its own.

The same workflow's `corpus` mode is what the private consumer runs on `main` or a schedule, with
`comment: false`: it reports every package in that repository and uploads the full summary, so requirement
G3's private-corpus half has an owner without exposing the private repository to this public one. The caller
supplies its own checkout; this repository only supplies the tool.

### 8.2 Judge selection and waiting

The comment marker is `<!-- api-extractor-change-report head=<sha40> -->`. The judge's pre-pass selects the
latest comment with the fixed prefix and checks the head SHA; it reads the Markdown. The report job finishes
inside the judge's five-minute deadline; the judge waits for the comment up to that deadline. A missing
comment makes the export and internal-import rules `Unclear`, never a pass. The JSON artifacts are the
machine view for non-judge consumers.

### 8.3 Corpus job in this repository

A new `api-corpus` job in `.github/workflows/ci.yml`, `needs: sfs-deps`, `timeout-minutes: 10`:

1. Checkout this repository; download `.sfs-deps`; install; build the CLI.
2. Checkout the public package monorepo at the pinned corpus SHA into `corpus/public` (public repository, no
   secret).
3. Install the corpus dependencies with `pnpm install --frozen-lockfile` in `corpus/public`, cached by the
   corpus lockfile hash and the corpus SHA. The job summary records the install time.
4. `api-extractor corpus --repo corpus/public --out api-corpus`.
5. Re-run a deterministic sample of five packages into `api-corpus-2` and compare the two report trees byte
   for byte; a difference fails the job.
6. Upload `api-corpus` (run summary, per-package JSON, partial list) and fail on an untyped refusal, an
   omitted package, a partial package, or the byte comparison. The summary names the file and construct.

The corpus job is not added to the repository's required checks by this spec (I-5).

### 8.4 Budgets and failure semantics

- Consumer PR job: at most two minutes for a PR touching at most three packages on the self-hosted runner.
- Corpus job: at most ten minutes, including the corpus install.
- A tool failure publishes a comment naming the package and reason; the judge records `Unclear`; the corpus
  job fails red. No job retries a hung analysis; the timeout is the stop.

## 9. Changeset bump check

`check-bump` reads one change report and the changeset files:

1. Parse `.changeset/*.md` frontmatter: the block between the first two `---` lines, one `"<package>": <bump>`
   entry per line; a package may appear in several changesets, and the highest bump wins. Quoted and
   unquoted keys, blank lines and the four bump values are handled; anything else is an input error (exit 2),
   never a silent pass.
2. Compare per package: declared lower than `report.bump` fails; a required non-`none` bump with no entry
   fails; `coverage.complete: false` fails with the reason; otherwise pass.
3. The failure message names the package, the declared bump, the required bump, the top finding's
   `reasonCode` and its anchor.
4. The command exits `1` on failure and `0` on pass. It reads the changeset files and the report; it never
   reads source text and never re-derives the bump.

The consumer workflow runs `check-bump` after the reports and puts its result in the same non-required job.
A real under-declared changeset proves the failure; a correct bump proves the pass; a PR with no public change
and no changeset passes.

## 10. Performance, the oracle and the state of the art

### 10.1 Benchmark

`apps/api-extractor-bench` runs both tools end to end on the public corpus:

- **Ours:** `api-extractor report` from source, cold and warm (five warm runs, median).
- **Upstream:** `@microsoft/api-extractor` 7.59.4 in the mode its users run it: emit declarations with its
  bundled TypeScript 5.9.3 (`tsc --declaration --emitDeclarationOnly`), then run api-extractor with a
  generated `api-extractor.json` (`mainEntryPointFilePath`, `dtsRollup`, `apiReport`). The emit and the
  extractor are both timed, because that is the oracle's end-to-end path.
- A package upstream refuses is listed with the reason and excluded from the ratio.
- Output: `benchmark.json` (canonical) and `benchmark.md`, with per-package and total wall clock, the phase
  breakdown, the corpus SHA, the tool versions and the host. The target is at least 10x total; otherwise the
  output states the measured ratio and the phase that stops it.

The benchmark CI job (`api-bench`, not a required check) reuses the corpus checkout and artifacts from
§8.3 and runs within the same ten-minute budget.

### 10.2 Profile

`apps/api-extractor-profile/profile.ts` gains phases: `report:json`, `report:markdown`, `change:diff`,
`change:import-index`. The committed profile covers the public corpus and names its SHA. The private consumer
corpus is profiled in its own CI summary, not committed to this public repository.

### 10.3 TypeScript 7.1 adapter

The `CompilerEmitter` port is the seam. The current adapter runs the TypeScript 7 process; when the
dependency is TypeScript 7.1 or later, a second adapter imports `typescript/sync` (the stable `API` entry
point) behind the same port and emits through a snapshot. The adapter is selected by a capability check, not
by a model flag, so a 7.0 dependency keeps the process path.

The proof is a port conformance test: a `CompilerEmitter` double and the process adapter analyse the same
fixture package and produce equal models once `producer.declarations` is set equal. The model schema does not
change. The `typescript/unstable/async` import the current adapter uses for config parsing is not treated as
the stable API; the 7.1 adapter uses the documented entry points.

### 10.4 Semantic conformance with the oracle

`apps/api-extractor-conformance` compares this tool's model with `@microsoft/api-extractor` 7.59.4's
`.api.json` on a curated fixture corpus:

- Fixtures: subpath exports, `export * as`, external re-exports, `declare global`, `declare module`,
  overloads, dual APIs, a value/type pair and a re-export cycle.
- Comparison: entry points, export names, kinds and normalised declaration text where both sides print one.
- Every difference is either fixed or recorded in `differences.md` with the fixture, the evidence and the
  Effect-aware reason. There is no byte comparison of `.api.md` and no gate on upstream formatting.
- `@microsoft/api-extractor-model` (Microsoft, pre-approved) parses the upstream document; the conformance
  app is the only importer of the upstream packages besides the benchmark.

## 11. Determinism, provenance and idiom

- **Canonical every output.** The report JSON, change report JSON, corpus summary, benchmark record and
  conformance record go through `canonicalJson`. Markdown is assembled from model order.
- **No locale.** `Order.String` and `canonicalKey`; no `Intl`, `toLocale*`, `localeCompare` or
  locale-dependent number formatting. Anchors use integer line numbers.
- **No ambient state.** No timestamp, host name, user name, absolute path, random id or process id in any
  output. The CLI takes the repository-relative package path and writes relative artifact paths.
- **Provenance.** The repository stays MIT with Microsoft's notice. No upstream code is copied; a file derived
  from upstream or a systemfsoftware PR carries its origin header. `@microsoft/api-extractor` and
  `@microsoft/api-extractor-model` are devDependencies of the benchmark and conformance apps only.
- **One barrel.** `@systemfsoftware/api-extractor` keeps its single `.` export and the `ApiModel`, `FrontEnd`
  and `Verdict` namespaces. The CLI, benchmark and conformance are separate private apps; none of them adds a
  subpath to the library.
- **Decision code.** The verdict stays an effect-cell workflow; the change report's per-change mapping is a
  pure function beside its schema; no decision lives in a CLI command. The `dmmf-workflow(make-body-purity)`
  lint gate must stay green.
- **Versions.** Any model change bumps `API_MODEL_SCHEMA_VERSION` (v3, then v4). Any corpus change bumps
  `corpusVersion`. The report and change report carry their own versions. The CLI refuses a version mismatch
  instead of coercing.
- **Mutation.** Stryker continues on `main` only; no per-PR mutation run.

## 12. Testing strategy

| Layer | Tests |
|---|---|
| Schema laws | `effect-schema-law` for `Anchor`, `ReleaseTag`, `ManifestEntry`, `CoverageReason`, `ApiReport`, `ChangeReport`, `Importer`, `ImporterGroup`; decode/encode round trips and recursion budgets. |
| Decisions and properties | `diffModels(model, model)` is empty; the existing verdict properties stay; the report render is idempotent and deterministic; the change detail keeps every change exactly once; importer joins are order-independent. |
| Integration (public surface) | Gherkin features for anchors, release tags, `@stability`, external re-exports, ambient declarations, imports maps, patterns, cycles, a value/type pair, a no-source refusal and a partial report. |
| CLI | `report`, `diff`, `corpus` and `check-bump` on temporary repositories with real git commits; canonical stdout; exit codes; no absolute paths. |
| E2E | The existing locale/time-zone/cwd probe extended with a report and a change report; the cross-host digest includes both; a `diff` run on a real two-commit temporary repo. |
| Corpus | The `api-corpus` job is the real test: every public package, the deterministic five-package byte comparison, the partial list and the run summary. |
| Negative | An unsupported construct yields `partial`; an unresolved external star yields `external-star`; a parse failure yields `parse`; a missing report is distinguishable from no change; an under-declared changeset fails. |

No test asserts configuration text or a file the same change writes. No deliberate-red public PR is used.
Mutation remains a `main`-only control.

## 13. Delivery sequence

M0 is a prerequisite: **PR #7** passes a non-author review that cites evidence and merges; its extensions are
not added to it (K4). Every unit below is one independent PR on trunk.

| Milestone | Unit | Scope |
|---|---|---|
| M1 — first deliverable | U1 | Model v3: anchors, release tags, `@stability`, manifest exports/imports, messages, coverage; source index; `readPackage` target/condition resolution. |
| M1 | U2 | Report schema, printer and renderer; `report` command; report tests. |
| M1 | U3 | Change report schema and detail mapping; import index; `diff` command; per-package and PR Markdown. |
| M1 | U4 | Reusable consumer workflow, sticky comment, JSON artifacts, judge consumption proof on a real PR. |
| M2 | U5 | Model v4: external re-exports and ambient declarations; the three previously refused constructs produce reports. |
| M3 | U6 | `api-corpus` job on the public corpus; deterministic sample; run summary. |
| M4 | U7 | `check-bump` command and its consumer-workflow step. |
| M5 | U8 | Benchmark app and CI job; profile phases. |
| M6 | U9 | TypeScript 7.1 adapter seam and port conformance test; semantic conformance app. |
| M7 | U10 | E2E determinism extension, cross-host digest, `docs/solutions/` entry if a durable counterfactual exists. |

M1 adds no corpus job, benchmark or changeset check (J-0). The model-version PRs (U1, U5) are serial with
every unit that touches `api-model.schema.ts`; the CLI app is touched by U2-U4, U7 and is therefore serial
within M1; the workflow file is touched by U4, U6-U8 and is serial there.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The base worktree has no dependencies, so the fallback cannot resolve imports. | Symlink the head `node_modules` into the base worktree and record `dependencies: "head"`; an unresolvable import becomes a coverage reason, never a wrong model. |
| Anchors cannot be mapped for a synthesized or re-exported symbol. | The source index maps by origin file, kind and name; an unmapped symbol gets `anchor: null` and an `unmapped-anchor` reason; the judge sees it as unanchored. |
| An external `export *` hides names. | The report prints the star re-export and marks enumeration partial with `external-star`; the judge can still reason about the module. |
| The corpus install exceeds the ten-minute budget. | Cache by corpus SHA and lockfile hash; the job summary records install and analysis time; a breach is reported as a budget miss, not hidden. |
| The judge runs before the report comment exists. | The comment marker and head SHA; the judge waits inside its five-minute deadline; a missing report is `Unclear`, never a pass. |
| The importer index is slow or partial on a large workspace. | One `oxc-parser` parse per file, in-memory cache, coverage counts; the two-minute consumer budget is measured; parse failures make the facts partial, not empty. |
| A model version bump breaks a stored model. | The CLI and the corpus job always produce both revisions with the same tool; a mismatch is a typed refusal (exit 3), and the corpus job reports it. |
| PR #7's review finds a shape problem. | K4's replacement path: the front-end is replaced then, and no requirement changes because every requirement is on behaviour. |
| A private name or path leaks into the public repository. | Neutral fixtures and generic corpus names; the pre-write and post-write `grep -ciE` check; spec documents stay uncommitted until scrubbed and approved. |

## 15. Verification matrix

| Requirement group | Evidence |
|---|---|
| C-1 — C-8 | `api-corpus` summary (package, entry-point and report counts; partial list); fixture features for anchors, tags, external, ambient, imports maps, patterns, cycles and no-source; spot-checked anchors. |
| R-1 — R-8 | Schema laws; report renderer tests; canonical bytes; determinism e2e; version-refusal test. |
| D-1 — D-7 | Change report fixture tests; importer join tests; map-delta tests; comment bound tests; `diff` on a two-commit repo. |
| B-1 — B-5 | Existing verdict tests; `check-bump` tests; a real under-declared changeset. |
| J-0 — J-5 | The real PR proof: report artifact id, the judge's answer and cited lines; the local `diff` command on a lane worktree; a missing report producing `Unclear`. |
| I-1 — I-5 | The corpus job run; the consumer workflow run; the job summary with wall times; the unchanged rulesets. |
| P-1 — P-5 | `benchmark.json`/`.md` with the ratio or ceiling; the profile; the adapter double; the conformance record. |
| Q-1 — Q-5 | `pnpm lint`, `pnpm typecheck`, `pnpm test`; the locale grep; the package export map; the provenance headers and devDependency ownership. |

## 16. Design decisions

- **Source index for anchors, not declaration maps.** Both routes produce the same anchor without a
  sourcemap, and the index also supplies release tags and stability; a null anchor is honest and visible.
- **Messages in the model.** The report reads only decoded model values (requirement R-1), so messages and
  coverage are part of the model wire, not a side channel.
- **Model v3 then v4.** The first deliverable needs anchors, tags, manifest and messages; external re-exports
  and ambient declarations are a separate small PR, per K4, and bump the model again.
- **A base worktree with the head's installed dependencies.** It keeps the two-revision command within the
  CI budget; the provenance field makes the choice visible, and a resolution failure becomes partial coverage.
- **Importer index over `oxc-parser` plus the workspace package list.** It is a real parser, not a text
  match; it reports what it could not parse instead of passing silently.
- **One sticky comment with a fixed marker.** The judge selects it without a new service; the updater finds it
  by the marker prefix, so a push never duplicates it.
- **`check-bump` in the CLI.** The comparison is deterministic and testable, and the workflow consumes the
  same command the write-time layer uses.
- **No new service and no new runtime dependency beyond PR #7's set.** The tool is a CLI plus CI workflows;
  the judge remains the only consumer that needs a hosted runtime.

There are no open design questions. The requirements' open decisions were settled by the lead's rulings K1-K4
and are recorded in `requirements.md` §9.
