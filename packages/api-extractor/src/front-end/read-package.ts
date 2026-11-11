import { Array as Arr, Effect, FileSystem, HashSet, Match, Option, Order, Path, Schema } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { AnchorBase, ManifestEntry, PackageSurface } from '../model/api-model.schema.ts'
import type { PackageSource, SourceEntryPoint } from './declarations.schema.ts'
import { directoryOf, relativeWithin } from './declaration-graph.ts'
import { ManifestRejected, NoSourceEntry } from './front-end-error.schema.ts'
import { isAbsent } from './package-file.ts'
import { type ExportTarget, PackageManifest, pathTargetOf, type ResolvedTarget, targetPathOf } from './package-source.schema.ts'

export const FAMILY_SOURCE_CONDITION = '@systemfsoftware/source'

export type ReadPackageRequest = {
  readonly packageRoot: string
  readonly sourceCondition?: string
}

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PackageManifest))

const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/

const isTypeScriptSource = (value: string): boolean => TYPESCRIPT_SOURCE.test(value)

const stripRelativePrefix = (value: string): string => value.replace(/^\.\//, '')

const byExportPath: Order.Order<SourceEntryPoint> = Order.mapInput(Order.String, (entry: SourceEntryPoint) => entry.exportPath)

const exportMapOf = (exports: PackageManifest['exports']): ReadonlyArray<readonly [string, ExportTarget]> =>
  Match.value(exports).pipe(
    Match.when(Match.string, (path) => [['.', pathTargetOf(path)] as const]),
    Match.when(Match.undefined, () => Arr.empty<readonly [string, ExportTarget]>()),
    Match.orElse((record) => Object.entries(record).filter(([exportPath]) => exportPath !== './package.json')),
  )

const importMapOf = (imports: PackageManifest['imports']): ReadonlyArray<readonly [string, ExportTarget]> =>
  Match.value(imports).pipe(
    Match.when(Match.undefined, () => Arr.empty<readonly [string, ExportTarget]>()),
    Match.orElse((record) => Object.entries(record)),
  )

const manifestEntryOf = (preferred: string) =>
  ([key, target]: readonly [string, ExportTarget]): ManifestEntry =>
    Option.match(targetPathOf(target, preferred), {
      onNone: () => ({ key, target: null, condition: null }),
      onSome: (resolved) => ({ key, target: resolved.path, condition: resolved.condition }),
    })

const surfaceOf = (manifest: PackageManifest, preferred: string): PackageSurface => ({
  name: manifest.name,
  version: manifest.version,
  exports: exportMapOf(manifest.exports).map(manifestEntryOf(preferred)),
  imports: importMapOf(manifest.imports).map(manifestEntryOf(preferred)),
})

const normalisedTarget = (path: string): string => (path.startsWith('./') ? path : `./${path}`)

type ResolvedEntry = ResolvedTarget & { readonly key: string }

const entryPointOf = (entry: ResolvedEntry): SourceEntryPoint => ({
  exportPath: entry.key,
  sourceFile: stripRelativePrefix(entry.path),
  key: entry.key,
  condition: entry.condition,
  target: normalisedTarget(entry.path),
})

const starCountOf = (exportPath: string): number => exportPath.split('*').length - 1

const isPatternKey = (exportPath: string): boolean => starCountOf(exportPath) === 1

const isExplicitKey = (exportPath: string): boolean => starCountOf(exportPath) === 0

type PatternParts = { readonly prefix: string; readonly suffix: string }

const patternPartsOf = (target: string): Option.Option<PatternParts> =>
  Option.flatMap(Option.liftPredicate(target.split('*'), (parts) => parts.length === 2), (parts) =>
    Option.all({ prefix: Arr.head(parts), suffix: Arr.get(parts, 1) }),
  )

const matchedSubstring = (prefix: string, suffix: string, candidate: string): Option.Option<string> =>
  Option.map(
    Option.filter(
      Option.filter(Option.liftPredicate(candidate, (value) => value.startsWith(prefix)), (value) => value.endsWith(suffix)),
      (value) => value.length >= prefix.length + suffix.length,
    ),
    (value) => value.slice(prefix.length, value.length - suffix.length),
  )

const INVALID_SEGMENT = /^(?:|\.|\.\.|node_modules)$/i

const isValidPatternMatch = (substring: string): boolean => !substring.split(/[/\\]/).some((segment) => INVALID_SEGMENT.test(segment))

const patternEntryOf = (key: string, prefix: string, suffix: string, condition: string | null) =>
  (candidate: string): Option.Option<PatternEntry> =>
    Option.map(Option.filter(matchedSubstring(prefix, suffix, candidate), isValidPatternMatch), (substring) => ({
      entry: {
        exportPath: key.replace('*', () => substring),
        sourceFile: candidate,
        key,
        condition,
        target: normalisedTarget(candidate),
      },
      key,
    }))

const joinRelative = (path: Path.Path, relative: string, name: string): string => path.join(relative, name).split(path.sep).join('/')

const withinRoot = (path: Path.Path, root: string, candidate: string): Option.Option<string> =>
  Option.orElse(relativeWithin(path, root, candidate), () => Option.liftPredicate(path.relative(root, candidate), (relative) => relative === ''))

type Platform = FileSystem.FileSystem | Path.Path

const listNames = (directory: string): Effect.Effect<ReadonlyArray<string>, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    return yield* fileSystem.readDirectory(directory).pipe(Effect.catchIf(isAbsent, () => Effect.succeed<ReadonlyArray<string>>([])))
  })

const isDirectory = (childPath: string): Effect.Effect<boolean, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    return yield* fileSystem.stat(childPath).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.catchIf(isAbsent, () => Effect.succeed(false)),
    )
  })

const directoryRealPath = (childPath: string): Effect.Effect<Option.Option<string>, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    return yield* (yield* isDirectory(childPath))
      ? Effect.asSome(fileSystem.realPath(childPath))
      : Effect.succeed(Option.none<string>())
  })

const MAX_PATTERN_DIRECTORIES = 1024

type Walk = { readonly names: ReadonlyArray<string>; readonly listed: number }

type WalkPattern = { readonly root: string; readonly key: string; readonly prefix: string }

type WalkError = PlatformError | ManifestRejected

const overBudget = (pattern: WalkPattern): ManifestRejected =>
  new ManifestRejected({
    packageRoot: pattern.root,
    issue: `the pattern export "${pattern.key}" reaches more than ${MAX_PATTERN_DIRECTORIES} directories`,
  })

const walkStep = (pattern: WalkPattern, relative: string, ancestors: HashSet.HashSet<string>, walk: Walk): Effect.Effect<Walk, WalkError, Platform> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const listed = walk.listed + 1
    const names = yield* (listed > MAX_PATTERN_DIRECTORIES
      ? Effect.fail(overBudget(pattern))
      : listNames(path.join(pattern.root, relative)))
    return yield* Effect.reduce(names, () => ({ names: walk.names, listed }), stepChild(pattern, relative, ancestors))
  })

const enterDirectory = (
  pattern: WalkPattern,
  relative: string,
  ancestors: HashSet.HashSet<string>,
  walk: Walk,
  realPath: string,
): Effect.Effect<Walk, WalkError, Platform> =>
  HashSet.has(ancestors, realPath) ? Effect.succeed(walk) : walkStep(pattern, relative, HashSet.add(ancestors, realPath), walk)

const leadsToPrefix = (prefix: string, childRelative: string): boolean =>
  `${childRelative}/`.startsWith(prefix) || prefix.startsWith(`${childRelative}/`)

const isInvalidInsideMatch = (pattern: WalkPattern, childRelative: string, name: string): boolean =>
  INVALID_SEGMENT.test(name) && pattern.prefix.length <= childRelative.length - name.length

const isUnmatchable = (pattern: WalkPattern, childRelative: string, name: string): boolean =>
  !leadsToPrefix(pattern.prefix, childRelative) || isInvalidInsideMatch(pattern, childRelative, name)

const stepChild = (pattern: WalkPattern, relative: string, ancestors: HashSet.HashSet<string>) =>
  (walk: Walk, name: string): Effect.Effect<Walk, WalkError, Platform> =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const childRelative = joinRelative(path, relative, name)
      return yield* isUnmatchable(pattern, childRelative, name)
        ? Effect.succeed(walk)
        : Option.match(yield* directoryRealPath(path.join(pattern.root, relative, name)), {
            onNone: () => Effect.succeed({ names: Arr.append(walk.names, childRelative), listed: walk.listed }),
            onSome: (realPath) => enterDirectory(pattern, childRelative, ancestors, walk, realPath),
          })
    })

const walkRelative = (pattern: WalkPattern, relative: string): Effect.Effect<ReadonlyArray<string>, WalkError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const absolute = path.join(pattern.root, relative)
    const seed = yield* fileSystem.realPath(absolute).pipe(Effect.catchIf(isAbsent, () => Effect.succeed(absolute)))
    const walk = yield* walkStep(pattern, relative, HashSet.make(seed), { names: [], listed: 0 })
    return walk.names
  })

const walkDirectory = (pattern: WalkPattern, directory: string): Effect.Effect<ReadonlyArray<string>, WalkError, Platform> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    return yield* Option.match(withinRoot(path, pattern.root, path.resolve(pattern.root, directory)), {
      onNone: () => Effect.succeed<ReadonlyArray<string>>([]),
      onSome: (relative) => walkRelative(pattern, relative),
    })
  })

type PatternEntry = { readonly entry: SourceEntryPoint; readonly key: string }

const patternPrecedence: Order.Order<string> = Order.combineAll([
  Order.mapInput(Order.Number, (key: string) => key.indexOf('*') + 1),
  Order.mapInput(Order.Number, (key: string) => key.length),
])

const baseOf = (key: string): string => key.slice(0, key.indexOf('*'))

const trailerOf = (key: string): string => key.slice(key.indexOf('*') + 1)

const startsPastBase = (exportPath: string, key: string): boolean => exportPath.startsWith(baseOf(key)) && exportPath !== baseOf(key)

const coversTrailer = (exportPath: string, key: string): boolean => exportPath.endsWith(trailerOf(key)) && exportPath.length >= key.length

const endsWithTrailer = (exportPath: string, key: string): boolean => trailerOf(key).length === 0 || coversTrailer(exportPath, key)

const keyMatches = (exportPath: string) => (key: string): boolean => startsPastBase(exportPath, key) && endsWithTrailer(exportPath, key)

const winningKeyOf = (patternKeys: ReadonlyArray<string>, exportPath: string): Option.Option<string> =>
  Arr.match(patternKeys.filter(keyMatches(exportPath)), {
    onEmpty: () => Option.none(),
    onNonEmpty: (matching) => Option.some(Arr.max(matching, patternPrecedence)),
  })

const isWinner = (patternKeys: ReadonlyArray<string>) => (item: PatternEntry): boolean =>
  Option.exists(winningKeyOf(patternKeys, item.entry.exportPath), (key) => key === item.key)

type PatternExpansion = {
  readonly key: string
  readonly resolved: boolean
  readonly entries: ReadonlyArray<PatternEntry>
}

const expandPattern = (root: string, preferred: string, key: string, target: ExportTarget): Effect.Effect<PatternExpansion, WalkError, Platform> =>
  Option.match(targetPathOf(target, preferred), {
    onNone: () => Effect.succeed<PatternExpansion>({ key, resolved: false, entries: [] }),
    onSome: ({ path: targetText, condition }) =>
      Option.match(patternPartsOf(targetText), {
        onNone: () => Effect.succeed<PatternExpansion>({ key, resolved: true, entries: [] }),
        onSome: (parts) => {
          const prefix = stripRelativePrefix(parts.prefix)
          return Effect.map(walkDirectory({ root, key, prefix }, directoryOf(prefix)), (candidates) => ({
            key,
            resolved: true,
            entries: Arr.getSomes(candidates.filter(isTypeScriptSource).map(patternEntryOf(key, prefix, parts.suffix, condition))),
          }))
        },
      }),
  })

const resolvedExplicit = (preferred: string) =>
  ([key, target]: readonly [string, ExportTarget]): Option.Option<ResolvedEntry> =>
    Option.map(targetPathOf(target, preferred), (resolved) => ({ ...resolved, key }))

const notSource = (entry: ResolvedEntry): boolean => !isTypeScriptSource(entry.path)

type ReadEntryPoints = {
  readonly entryPoints: ReadonlyArray<SourceEntryPoint>
  readonly patternEmpties: ReadonlyArray<string>
}

const hasDeclaredSurface = (read: ReadEntryPoints, surface: PackageSurface): boolean =>
  read.entryPoints.length > 0 || surface.imports.length > 0

const preferredConditionOf = (request: ReadPackageRequest): string => request.sourceCondition ?? FAMILY_SOURCE_CONDITION

const entryPointsOf = (
  root: string,
  manifest: PackageManifest,
  preferred: string,
): Effect.Effect<ReadEntryPoints, NoSourceEntry | WalkError, Platform> =>
  Effect.gen(function* () {
    const entries = exportMapOf(manifest.exports)
    const explicit = entries.filter(([exportPath]) => isExplicitKey(exportPath))
    const patterns = entries.filter(([exportPath]) => isPatternKey(exportPath))
    const resolved = Arr.getSomes(explicit.map(resolvedExplicit(preferred)))
    yield* Option.match(Arr.findFirst(resolved, notSource), {
      onNone: () => Effect.void,
      onSome: (entry) => Effect.fail(new NoSourceEntry({ packageRoot: root, exportKey: entry.key, target: entry.path })),
    })
    const explicitPaths = HashSet.fromIterable(explicit.map(([exportPath]) => exportPath))
    const expanded = yield* Effect.forEach(patterns, ([key, target]) => expandPattern(root, preferred, key, target), { concurrency: 1 })
    const chosen = Arr.flatten(expanded.map((expansion) => expansion.entries))
      .filter((item) => !HashSet.has(explicitPaths, item.entry.exportPath))
      .filter(isWinner(patterns.map(([key]) => key)))
    const explicitEntries = resolved.filter((entry) => !notSource(entry)).map(entryPointOf)
    return {
      entryPoints: Arr.sort([...explicitEntries, ...chosen.map((item) => item.entry)], byExportPath),
      patternEmpties: expanded
        .filter((expansion) => expansion.resolved && expansion.entries.length === 0)
        .map((expansion) => expansion.key),
    }
  })

const workspaceRootFrom = (directory: string, packageRoot: string): Effect.Effect<string, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const holdsWorkspace = yield* fileSystem.exists(path.join(directory, 'pnpm-workspace.yaml'))
    return holdsWorkspace ? directory : yield* workspaceRootAbove(path.dirname(directory), directory, packageRoot)
  })

const workspaceRootAbove = (parent: string, directory: string, packageRoot: string): Effect.Effect<string, PlatformError, Platform> =>
  parent === directory ? Effect.succeed(packageRoot) : workspaceRootFrom(parent, packageRoot)

const tsconfigOf = (root: string): Effect.Effect<string, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const buildConfig = path.join(root, 'tsconfig.build.json')
    return (yield* fileSystem.exists(buildConfig)) ? buildConfig : path.join(root, 'tsconfig.json')
  })

type SourceReading = {
  readonly root: string
  readonly manifest: PackageManifest
  readonly surface: PackageSurface
  readonly entryPoints: ReadonlyArray<SourceEntryPoint>
  readonly patternEmpties: ReadonlyArray<string>
}

const anchorBaseOf = (insideWorkspace: boolean): AnchorBase => (insideWorkspace ? 'workspace' : 'package')

const anchorPrefixOf = (insideWorkspace: boolean, relative: string): string => (insideWorkspace ? relative : '')

const sourceOf = (reading: SourceReading): Effect.Effect<PackageSource, PlatformError, Platform> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const workspaceRoot = yield* workspaceRootFrom(reading.root, reading.root)
    const insideWorkspace = workspaceRoot !== reading.root
    const relative = path.relative(workspaceRoot, reading.root).split(path.sep).join('/')
    const source: PackageSource = {
      name: reading.manifest.name,
      version: reading.manifest.version,
      packageRoot: reading.root,
      workspaceRoot,
      tsconfigPath: yield* tsconfigOf(reading.root),
      anchorBase: anchorBaseOf(insideWorkspace),
      anchorPrefix: anchorPrefixOf(insideWorkspace, relative),
      manifest: reading.surface,
      patternEmpties: reading.patternEmpties,
      entryPoints: reading.entryPoints,
    }
    return source
  })

export const readPackage = (request: ReadPackageRequest): Effect.Effect<PackageSource, NoSourceEntry | ManifestRejected | PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = path.resolve(request.packageRoot)
    const manifest = yield* decodeManifest(yield* fileSystem.readFileString(path.join(root, 'package.json'))).pipe(
      Effect.catchTag('SchemaError', (error) => Effect.fail(new ManifestRejected({ packageRoot: root, issue: error.message }))),
    )
    const preferred = preferredConditionOf(request)
    const surface = surfaceOf(manifest, preferred)
    const read = yield* entryPointsOf(root, manifest, preferred)
    return yield* Match.value(hasDeclaredSurface(read, surface)).pipe(
      Match.when(true, () => sourceOf({ root, manifest, surface, entryPoints: read.entryPoints, patternEmpties: read.patternEmpties })),
      Match.orElse(() => Effect.fail(new NoSourceEntry({ packageRoot: root }))),
    )
  })
