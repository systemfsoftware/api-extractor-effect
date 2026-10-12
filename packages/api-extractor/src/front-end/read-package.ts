import { Array as Arr, Effect, FileSystem, Option, Order, Path, Schema } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { PackageSource, SourceEntryPoint } from './declarations.schema.ts'
import { NoSourceEntry } from './front-end-error.schema.ts'
import { type ExportTarget, PackageManifest } from './package-source.schema.ts'

export const FAMILY_SOURCE_CONDITION = '@systemfsoftware/source'

export type ReadPackageRequest = {
  readonly packageRoot: string
  readonly sourceCondition?: string
}

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PackageManifest))

const TYPESCRIPT_SOURCE = /\.m?tsx?$/

const isTypeScriptSource = (value: Schema.Json | undefined): value is string => typeof value === 'string' && TYPESCRIPT_SOURCE.test(value)

const conditionTarget = (target: ExportTarget, condition: string): Option.Option<string> =>
  typeof target === 'string' ? Option.none() : Option.liftPredicate(target[condition], isTypeScriptSource)

const entryPointOf = ([exportPath, target]: readonly [string, ExportTarget], condition: string): Option.Option<SourceEntryPoint> =>
  Option.map(conditionTarget(target, condition), (sourceFile) => ({ exportPath, sourceFile: sourceFile.replace(/^\.\//, '') }))

const byExportPath: Order.Order<SourceEntryPoint> = Order.mapInput(Order.String, (entry: SourceEntryPoint) => entry.exportPath)

const exportMapOf = (exports: PackageManifest['exports']): ReadonlyArray<readonly [string, ExportTarget]> =>
  typeof exports === 'object' ? Object.entries(exports).filter(([exportPath]) => exportPath !== './package.json') : []

const entryPointsOf = (manifest: PackageManifest, condition: string): ReadonlyArray<SourceEntryPoint> =>
  Arr.sort(Arr.getSomes(exportMapOf(manifest.exports).map((entry) => entryPointOf(entry, condition))), byExportPath)

type Platform = FileSystem.FileSystem | Path.Path

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

const sourceOf = (root: string, manifest: PackageManifest, entryPoints: Arr.NonEmptyReadonlyArray<SourceEntryPoint>) =>
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

export const readPackage = (request: ReadPackageRequest): Effect.Effect<PackageSource, NoSourceEntry | PlatformError | Schema.SchemaError, Platform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = path.resolve(request.packageRoot)
    const manifest = yield* decodeManifest(yield* fileSystem.readFileString(path.join(root, 'package.json')))
    const entryPoints = entryPointsOf(manifest, request.sourceCondition ?? FAMILY_SOURCE_CONDITION)
    return yield* Arr.match(entryPoints, {
      onEmpty: () => Effect.fail(new NoSourceEntry({ packageRoot: root })),
      onNonEmpty: (nonEmpty) => sourceOf(root, manifest, nonEmpty),
    })
  })
