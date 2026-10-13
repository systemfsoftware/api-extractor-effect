import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Layer, Option, Path, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import typescriptManifest from 'typescript/package.json' with { type: 'json' }
import { type CompilerOutput, parseCompilerOutput } from './compiler-output.schema.ts'
import { closeDeclarations, entryPointDeclarations, missingEntryDeclarations, relativeWithin, type EntryDeclaration, type UnresolvedImport } from './declaration-graph.ts'
import { CompilerEmitter, type CompilerEmitterId, type DeclarationEmitter } from './declaration-emitter.service.ts'
import type { Declarations, Diagnostic, PackageSource } from './declarations.schema.ts'
import { CompilerRejected, UnsupportedDeclaration } from './front-end-error.schema.ts'

export const TYPESCRIPT_PRODUCER: string = `typescript@${typescriptManifest.version}`

const TYPESCRIPT_MANIFEST_URL: string = import.meta.resolve('typescript/package.json')

const TSC_SCRIPT: string = typescriptManifest.bin.tsc

type EmittedDeclaration = { readonly declared: string; readonly emittedFile: string }

type CompilerRun = {
  readonly output: CompilerOutput
  readonly exitCode: number
  readonly stderr: string
  readonly outDir: string
}

const compilerArguments = (source: PackageSource, outDir: string): ReadonlyArray<string> => [
  '-p',
  source.tsconfigPath,
  '--noEmit',
  'false',
  '--declaration',
  '--emitDeclarationOnly',
  '--declarationMap',
  'false',
  '--sourceMap',
  'false',
  '--stripInternal',
  'false',
  '--removeComments',
  'false',
  '--incremental',
  'false',
  '--composite',
  'false',
  '--tsBuildInfoFile',
  'null',
  '--rootDir',
  source.workspaceRoot,
  '--outDir',
  outDir,
  '--declarationDir',
  outDir,
  '--listEmittedFiles',
  '--pretty',
  'false',
]

const drain = (stream: Stream.Stream<Uint8Array, PlatformError>): Effect.Effect<string, PlatformError> =>
  Stream.decodeText(stream).pipe(Stream.mkString)

const runCompiler = (source: PackageSource, tsc: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const outDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'api-extractor-tsc-' })
    const handle = yield* spawner.spawn(
      ChildProcess.make(process.execPath, [tsc, ...compilerArguments(source, outDir)], { cwd: source.packageRoot }),
    )
    const [stdout, stderr] = yield* Effect.all([drain(handle.stdout), drain(handle.stderr)], { concurrency: 2 })
    const exitCode = yield* handle.exitCode
    return { output: parseCompilerOutput({ stdout, packageRoot: source.packageRoot }), exitCode, stderr, outDir }
  })

const exitDiagnostic = (exitCode: number, stderr: string): Diagnostic => ({
  file: '',
  message: stderr.trim() === '' ? `\`tsc\` exited with code ${exitCode}` : `\`tsc\` exited with code ${exitCode}: ${stderr.trim()}`,
})

const rejectionOf = (run: CompilerRun): Option.Option<ReadonlyArray<Diagnostic>> =>
  Option.orElse(Option.liftPredicate(run.output.diagnostics, Arr.isReadonlyArrayNonEmpty), () =>
    Option.map(Option.liftPredicate(run.exitCode, (code) => code !== 0), (code) => [exitDiagnostic(code, run.stderr)]))

const packageDeclarationOf = (path: Path.Path, declaredRoot: string, emittedFile: string): Option.Option<EmittedDeclaration> =>
  Option.map(relativeWithin(path, declaredRoot, emittedFile), (declared) => ({ declared, emittedFile }))

const missingEntryDiagnostic = (declarationFile: string): Diagnostic => ({
  file: declarationFile,
  message: 'the compiler emitted no declaration for this entry point',
})

const unsupportedImport = (unresolved: UnresolvedImport): UnsupportedDeclaration =>
  new UnsupportedDeclaration({ file: unresolved.file, construct: `the import \`${unresolved.specifier}\` names no declaration file` })

const declarationsOf = (
  source: PackageSource,
  entryPoints: ReadonlyArray<EntryDeclaration>,
  emitted: HashMap.HashMap<string, string>,
): Effect.Effect<Declarations, UnsupportedDeclaration> =>
  Effect.flatMap(
    closeDeclarations({
      entryDeclarations: entryPoints.map((entry) => entry.declarationFile),
      load: (declarationFile) => Effect.succeed(HashMap.get(emitted, declarationFile)),
    }),
    (report) =>
      Arr.match(report.unresolvedImports, {
        onEmpty: (): Effect.Effect<Declarations, UnsupportedDeclaration> =>
          Effect.succeed({
            producer: TYPESCRIPT_PRODUCER,
            package: { name: source.name, version: source.version },
            entryPoints,
            files: report.files,
          }),
        onNonEmpty: ([unresolved]) => Effect.fail(unsupportedImport(unresolved)),
      }),
  )

const declarationsFrom = (source: PackageSource, run: CompilerRun) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fileSystem = yield* FileSystem.FileSystem
    const declaredRoot = path.join(run.outDir, path.relative(source.workspaceRoot, source.packageRoot))
    const declared = Arr.getSomes(run.output.emittedFiles.map((emittedFile) => packageDeclarationOf(path, declaredRoot, emittedFile)))
    const emitted = HashMap.fromIterable(
      yield* Effect.forEach(declared, (declaration) =>
        Effect.map(fileSystem.readFileString(declaration.emittedFile), (text) => [declaration.declared, text] as const),
      ),
    )
    const entryPoints = entryPointDeclarations(source.entryPoints)
    return yield* Arr.match(missingEntryDeclarations(HashSet.fromIterable(HashMap.keys(emitted)), entryPoints.map((entry) => entry.declarationFile)), {
      onEmpty: () => declarationsOf(source, entryPoints, emitted),
      onNonEmpty: (missing) => Effect.fail(new CompilerRejected({ diagnostics: missing.map(missingEntryDiagnostic) })),
    })
  })

const emit = (source: PackageSource, tsc: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const run = yield* runCompiler(source, tsc)
      return yield* Option.match(rejectionOf(run), {
        onNone: () => declarationsFrom(source, run),
        onSome: (diagnostics) => Effect.fail(new CompilerRejected({ diagnostics })),
      })
    }),
  )

export const layer: Layer.Layer<
  CompilerEmitterId,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  CompilerEmitter,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>()
    const tsc = yield* Effect.orDie(path.fromFileUrl(new URL(TSC_SCRIPT, TYPESCRIPT_MANIFEST_URL)))
    const emitter: DeclarationEmitter<CompilerRejected> = { emit: (source) => Effect.provideContext(emit(source, tsc), services) }
    return emitter
  }),
)
