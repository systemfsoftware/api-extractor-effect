import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Match, Option, Order, Path, Schema } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { PackageSource, SourceEntryPoint } from './declarations.schema.ts'
import { relativeWithin } from './declaration-graph.ts'
import { ManifestRejected, NoSourceEntry } from './front-end-error.schema.ts'
import { type ExportTarget, PackageManifest } from './package-source.schema.ts'

export const FAMILY_SOURCE_CONDITION = '@systemfsoftware/source'

export type ReadPackageRequest = {
  readonly packageRoot: string
  readonly sourceCondition?: string
}

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PackageManifest))

const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/

const isTypeScriptSource = (value: string): boolean => TYPESCRIPT_SOURCE.test(value)

const stripRelativePrefix = (value: string): string => value.replace(/^\.\//, '')

const sourcePathOf = (target: ExportTarget): Option.Option<string> =>
  Match.value(target).pipe(
    Match.tag('Path', ({ path }) => Option.some(path)),
    Match.orElse(() => Option.none()),
  )

const conditionValue = (target: ExportTarget, condition: string): Option.Option<string> =>
  Match.value(target).pipe(
    Match.tag('Conditions', ({ conditions }) => Option.flatMap(Option.fromNullishOr(conditions[condition]), sourcePathOf)),
    Match.orElse(() => Option.none()),
  )

const entryPointOf = (condition: string) =>
  ([exportPath, target]: readonly [string, ExportTarget]): Option.Option<SourceEntryPoint> =>
    Option.map(Option.filter(conditionValue(target, condition), isTypeScriptSource), (sourceFile) => ({
      exportPath,
      sourceFile: stripRelativePrefix(sourceFile),
    }))

const byExportPath: Order.Order<SourceEntryPoint> = Order.mapInput(Order.String, (entry: SourceEntryPoint) => entry.exportPath)

const exportMapOf = (exports: PackageManifest['exports']): ReadonlyArray<readonly [string, ExportTarget]> =>
  Match.value(exports).pipe(
    Match.when(Match.string, () => []),
    Match.when(Match.undefined, () => []),
    Match.orElse((record) => Object.entries(record).filter(([exportPath]) => exportPath !== './package.json')),
  )

const isPatternKey = (exportPath: string): boolean => exportPath.includes('*')

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

const patternEntryOf = (key: string, prefix: string, suffix: string) =>
  (candidate: string): Option.Option<PatternEntry> =>
    Option.map(Option.filter(matchedSubstring(prefix, suffix, candidate), isValidPatternMatch), (substring) => ({
      entry: { exportPath: key.replace('*', substring), sourceFile: candidate },
      key,
    }))

const directoryOf = (relative: string): string => {
  const at = relative.lastIndexOf('/')
  return at === -1 ? '' : relative.slice(0, at)
}

const joinRelative = (path: Path.Path, relative: string, name: string): string => path.join(relative, name).split(path.sep).join('/')

const absent = (error: PlatformError): boolean =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', 'BadResource', () => true),
    Match.orElse(() => false),
  )

const withinRoot = (path: Path.Path, root: string, candidate: string): Option.Option<string> =>
  Option.orElse(relativeWithin(path, root, candidate), () => Option.liftPredicate(path.relative(root, candidate), (relative) => relative === ''))

type Platform = FileSystem.FileSystem | Path.Path

const walkDirectory = (root: string, directory: string): Effect.Effect<ReadonlyArray<string>, PlatformError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* Option.match(withinRoot(path, root, path.resolve(root, directory)), {
      onNone: () => Effect.succeed<ReadonlyArray<string>>([]),
      onSome: (relative) =>
        fileSystem.readDirectory(path.join(root, relative), { recursive: true }).pipe(
          Effect.catchIf(absent, () => Effect.succeed<ReadonlyArray<string>>([])),
          Effect.map((names) => names.map((name) => joinRelative(path, relative, name))),
        ),
    })
  })

type PatternEntry = { readonly entry: SourceEntryPoint; readonly key: string }

const patternPrecedence: Order.Order<string> = Order.combineAll([
  Order.mapInput(Order.Number, (key: string) => key.indexOf('*') + 1),
  Order.mapInput(Order.Number, (key: string) => key.length),
])

const preferredPattern = (candidate: PatternEntry, known: PatternEntry): PatternEntry =>
  patternPrecedence(candidate.key, known.key) > 0 ? candidate : known

const bestPerPath = (items: ReadonlyArray<PatternEntry>): ReadonlyArray<PatternEntry> =>
  Arr.fromIterable(
    HashMap.values(
      Arr.reduce(items, HashMap.empty<string, PatternEntry>(), (best, item) =>
        HashMap.set(
          best,
          item.entry.exportPath,
          Option.match(HashMap.get(best, item.entry.exportPath), { onNone: () => item, onSome: (known) => preferredPattern(item, known) }),
        ),
      ),
    ),
  )

const expandPattern = (root: string, condition: string, key: string, target: ExportTarget): Effect.Effect<ReadonlyArray<PatternEntry>, PlatformError, Platform> =>
  Option.match(conditionValue(target, condition), {
    onNone: () => Effect.succeed<ReadonlyArray<PatternEntry>>([]),
    onSome: (targetText) =>
      Option.match(patternPartsOf(targetText), {
        onNone: () => Effect.succeed<ReadonlyArray<PatternEntry>>([]),
        onSome: (parts) =>
          Effect.map(walkDirectory(root, directoryOf(stripRelativePrefix(parts.prefix))), (candidates) =>
            Arr.getSomes(candidates.filter(isTypeScriptSource).map(patternEntryOf(key, stripRelativePrefix(parts.prefix), parts.suffix))),
          ),
      }),
  })

const entryPointsOf = (root: string, manifest: PackageManifest, condition: string): Effect.Effect<ReadonlyArray<SourceEntryPoint>, PlatformError, Platform> =>
  Effect.gen(function* () {
    const entries = exportMapOf(manifest.exports)
    const explicit = entries.filter(([exportPath]) => !isPatternKey(exportPath))
    const patterns = entries.filter(([exportPath]) => isPatternKey(exportPath))
    const explicitPaths = HashSet.fromIterable(explicit.map(([exportPath]) => exportPath))
    const expanded = yield* Effect.forEach(patterns, ([key, target]) => expandPattern(root, condition, key, target), { concurrency: 1 })
    const chosen = bestPerPath(Arr.flatten(expanded).filter((item) => !HashSet.has(explicitPaths, item.entry.exportPath)))
    return Arr.sort([...explicit.map(entryPointOf(condition)).flatMap(Option.toArray), ...chosen.map((item) => item.entry)], byExportPath)
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

const sourceOf = (root: string, manifest: PackageManifest, entryPoints: Arr.NonEmptyReadonlyArray<SourceEntryPoint>): Effect.Effect<PackageSource, PlatformError, Platform> =>
  Effect.gen(function* () {
    const source: PackageSource = {
      name: manifest.name,
      version: manifest.version,
      packageRoot: root,
      workspaceRoot: yield* workspaceRootFrom(root, root),
      tsconfigPath: yield* tsconfigOf(root),
      entryPoints,
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
    const entryPoints = yield* entryPointsOf(root, manifest, request.sourceCondition ?? FAMILY_SOURCE_CONDITION)
    return yield* Arr.match(entryPoints, {
      onEmpty: () => Effect.fail(new NoSourceEntry({ packageRoot: root })),
      onNonEmpty: (nonEmpty) => sourceOf(root, manifest, nonEmpty),
    })
  })
