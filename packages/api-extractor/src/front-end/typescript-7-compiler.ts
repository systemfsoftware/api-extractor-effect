import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Layer, Option, Path, type Scope, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { API, DiagnosticCategory, type Diagnostic as ApiDiagnostic, type Program } from 'typescript/unstable/async'
import typescriptManifest from 'typescript/package.json' with { type: 'json' }
import { closeDeclarations, entryPointDeclarations, missingEntryDeclarations, relativeWithin, sharedDeclarations, sourceCandidatesOf, type EntryDeclaration, type SharedDeclaration, type UnresolvedImport, uniqueSources } from './declaration-graph.ts'
import { CompilerEmitter, type CompilerEmitterId, type DeclarationEmitter } from './declaration-emitter.service.ts'
import type { DeclarationFile, Declarations, Diagnostic, PackageSource, SourceEntryPoint, SourceFile } from './declarations.schema.ts'
import { CompilerRejected, UnsupportedDeclaration } from './front-end-error.schema.ts'
import { isDeclarationFile, readPackageFile } from './package-file.ts'

export const TYPESCRIPT_PRODUCER: string = `typescript@${typescriptManifest.version}`

const TYPESCRIPT_MANIFEST_URL: string = import.meta.resolve('typescript/package.json')

const TSC_SCRIPT: string = typescriptManifest.bin.tsc

const DERIVED_CONFIG_NAME = 'tsconfig.json'

const KEY_SEPARATOR = '\u0000'

const ENTRY_SEPARATOR = ' and '

export type CompilerEmitPolicy = {
  readonly noEmit: false
  readonly declaration: true
  readonly emitDeclarationOnly: true
  readonly declarationMap: false
  readonly sourceMap: false
  readonly stripInternal: false
  readonly isolatedDeclarations: false
  readonly removeComments: false
  readonly incremental: false
  readonly composite: false
  readonly tsBuildInfoFile: null
  readonly rootDir: string
  readonly outDir: string
  readonly declarationDir: string
}

export type CompilerEmitPolicyRequest = {
  readonly workspaceRoot: string
  readonly outDir: string
}

export const compilerEmitPolicy: (request: CompilerEmitPolicyRequest) => CompilerEmitPolicy = ({ workspaceRoot, outDir }) => ({
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  declarationMap: false,
  sourceMap: false,
  stripInternal: false,
  isolatedDeclarations: false,
  removeComments: false,
  incremental: false,
  composite: false,
  tsBuildInfoFile: null,
  rootDir: workspaceRoot,
  outDir,
  declarationDir: outDir,
})

const ancestorsOf = (path: Path.Path, directory: string): ReadonlyArray<string> => {
  const parent = path.dirname(directory)
  return parent === directory ? [directory] : [directory, ...ancestorsOf(path, parent)]
}

const NODE_MODULES = 'node_modules'

const MIRRORED_NODE_MODULES_SEGMENT = 'node_modules.mirrored'

const mirroredSegment = (segment: string): string => (segment === NODE_MODULES ? MIRRORED_NODE_MODULES_SEGMENT : segment)

const mirroredDirectory = (path: Path.Path, mirrorRoot: string, directory: string): string =>
  path.join(mirrorRoot, ...path.relative(path.parse(directory).root, directory).split(path.sep).map(mirroredSegment))

const looksUpNodeModules = (path: Path.Path, directory: string): boolean => path.basename(directory) !== NODE_MODULES

const mirrorNodeModules = (mirrorRoot: string, directory: string): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const mirrored = mirroredDirectory(path, mirrorRoot, directory)
    const nodeModules = path.join(directory, NODE_MODULES)
    yield* fileSystem.makeDirectory(mirrored, { recursive: true })
    yield* Effect.when(
      fileSystem.symlink(nodeModules, path.join(mirrored, NODE_MODULES)),
      Effect.map(fileSystem.exists(nodeModules), (exists) => exists && looksUpNodeModules(path, directory)),
    )
  })

const packageFileNames = (packageRoot: string, tsconfigPath: string): Effect.Effect<Option.Option<ReadonlyArray<string>>> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new API({ cwd: packageRoot })),
    (api) => Effect.map(Effect.promise(() => api.parseConfigFile(tsconfigPath)), (parsed) => Option.some(parsed.fileNames)),
    (api) => Effect.ignoreCause(Effect.promise(() => api.close())),
  ).pipe(Effect.catchCause(() => Effect.succeedNone))

const rootFilesField = (fileNames: Option.Option<ReadonlyArray<string>>): { readonly files?: ReadonlyArray<string> } =>
  Option.match(fileNames, { onNone: () => ({}), onSome: (files) => ({ files }) })

export type DerivedTsconfigRequest = {
  readonly tsconfigPath: string
  readonly packageRoot: string
  readonly workspaceRoot: string
  readonly outDir: string
}

export const writeDerivedTsconfig = (request: DerivedTsconfigRequest): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const mirrorRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'api-extractor-tsconfig-' })
    const configDirectory = path.dirname(request.tsconfigPath)
    yield* Effect.forEach(ancestorsOf(path, configDirectory), (directory) => mirrorNodeModules(mirrorRoot, directory), { discard: true })
    const derived = path.join(mirroredDirectory(path, mirrorRoot, configDirectory), DERIVED_CONFIG_NAME)
    const fileNames = yield* packageFileNames(request.packageRoot, request.tsconfigPath)
    yield* fileSystem.writeFileString(
      derived,
      JSON.stringify({
        extends: request.tsconfigPath,
        compilerOptions: compilerEmitPolicy({ workspaceRoot: request.workspaceRoot, outDir: request.outDir }),
        ...rootFilesField(fileNames),
      }),
    )
    return derived
  })

type EmittedDeclaration = { readonly declared: string; readonly emittedFile: string }

type CompilerRun = {
  readonly derived: string
  readonly exitCode: number
  readonly outDir: string
  readonly stderr: string
  readonly stdout: string
}

const drain = (stream: Stream.Stream<Uint8Array, PlatformError>): Effect.Effect<string, PlatformError> =>
  Stream.decodeText(stream).pipe(Stream.mkString)

const runCompiler = (source: PackageSource, tsc: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const outDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'api-extractor-tsc-' })
    const derived = yield* writeDerivedTsconfig({ tsconfigPath: source.tsconfigPath, packageRoot: source.packageRoot, workspaceRoot: source.workspaceRoot, outDir })
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [tsc, '-p', derived], { cwd: source.packageRoot }))
    const [stdout, stderr] = yield* Effect.all([drain(handle.stdout), drain(handle.stderr)], { concurrency: 2 })
    const exitCode = yield* handle.exitCode
    return { derived, exitCode, outDir, stderr, stdout }
  })

const exitMessage = (exitCode: number, stdout: string, stderr: string): string =>
  Arr.match(
    [stdout.trim(), stderr.trim()].filter((text) => text !== ''),
    {
      onEmpty: () => `\`tsc\` exited with code ${exitCode}`,
      onNonEmpty: (texts) => [`\`tsc\` exited with code ${exitCode}`, ...texts].join('\n'),
    },
  )

const exitDiagnostic = (run: CompilerRun): Diagnostic => ({ _tag: 'Note', message: exitMessage(run.exitCode, run.stdout, run.stderr) })

const indented = (text: string): string => text.replaceAll('\n', '\n  ')

const chainText = (diagnostic: ApiDiagnostic): string =>
  Arr.match(diagnostic.messageChain ?? [], {
    onEmpty: () => diagnostic.text,
    onNonEmpty: (chain) => `${diagnostic.text}\n  ${chain.map((next) => indented(chainText(next))).join('\n  ')}`,
  })

const fileFieldOf = (path: Path.Path, packageRoot: string, fileName: Option.Option<string>): { readonly file?: string } =>
  Option.match(
    Option.flatMap(fileName, (name) => relativeWithin(path, packageRoot, path.resolve(packageRoot, name))),
    { onNone: () => ({}), onSome: (file) => ({ file }) },
  )

const apiDiagnostic = (path: Path.Path, packageRoot: string, diagnostic: ApiDiagnostic): Diagnostic => ({
  _tag: 'Reported',
  ...fileFieldOf(path, packageRoot, Option.fromNullishOr(diagnostic.fileName)),
  code: diagnostic.code,
  message: chainText(diagnostic),
})

const diagnosticKey = (diagnostic: ApiDiagnostic): string =>
  [diagnostic.fileName ?? '', diagnostic.pos, diagnostic.code, diagnostic.text].join(KEY_SEPARATOR)

const isError = (diagnostic: ApiDiagnostic): boolean => diagnostic.category === DiagnosticCategory.Error

const errorDiagnostics = (diagnostics: ReadonlyArray<ApiDiagnostic>): ReadonlyArray<ApiDiagnostic> =>
  Arr.dedupeWith(Arr.filter(diagnostics, isError), (left, right) => diagnosticKey(left) === diagnosticKey(right))

type DiagnosticGroup = (program: Program) => Promise<ReadonlyArray<ApiDiagnostic>>

const diagnosticGroupsInReportingOrder: ReadonlyArray<DiagnosticGroup> = [
  (program) => program.getConfigFileParsingDiagnostics(),
  (program) => program.getSyntacticDiagnostics(),
  (program) => program.getProgramDiagnostics(),
  (program) => program.getGlobalDiagnostics(),
  (program) => program.getSemanticDiagnostics(),
  (program) => program.getDeclarationDiagnostics(),
]

const gather = async (program: Program): Promise<ReadonlyArray<ApiDiagnostic>> => {
  const collected: Array<ApiDiagnostic> = []
  for (const group of diagnosticGroupsInReportingOrder) {
    collected.push(...(await group(program)))
  }
  return collected
}

const programOf = async (api: API, derived: string): Promise<Option.Option<Program>> => {
  const snapshot = await api.updateSnapshot({ openProjects: [derived] })
  const project = snapshot.getProject(derived)
  return project === undefined ? Option.none() : Option.some(project.program)
}

const apiErrors = async (api: API, derived: string): Promise<ReadonlyArray<ApiDiagnostic>> =>
  Option.match(await programOf(api, derived), {
    onNone: async () => [],
    onSome: (program) => gather(program),
  })

const collectApiErrors = (packageRoot: string, derived: string): Effect.Effect<ReadonlyArray<ApiDiagnostic>> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new API({ cwd: packageRoot })),
    (api) => Effect.map(Effect.promise(() => apiErrors(api, derived)), errorDiagnostics),
    (api) => Effect.ignoreCause(Effect.promise(() => api.close())),
  ).pipe(Effect.catchCause(() => Effect.succeed<ReadonlyArray<ApiDiagnostic>>([])))

const refusal = (source: PackageSource, run: CompilerRun) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const found = yield* collectApiErrors(source.packageRoot, run.derived)
    const diagnostics = Arr.match(found, {
      onEmpty: () => [exitDiagnostic(run)],
      onNonEmpty: (errors) => errors.map((diagnostic) => apiDiagnostic(path, source.packageRoot, diagnostic)),
    })
    return yield* new CompilerRejected({ diagnostics })
  })

const packageDeclarationOf = (path: Path.Path, declaredRoot: string, emittedFile: string): Option.Option<EmittedDeclaration> =>
  Option.map(relativeWithin(path, declaredRoot, emittedFile), (declared) => ({ declared, emittedFile }))

const emittedDeclarationFiles = (path: Path.Path, fileSystem: FileSystem.FileSystem, outDir: string, declaredRoot: string) =>
  Effect.map(
    fileSystem.readDirectory(outDir, { recursive: true }),
    (names): ReadonlyArray<EmittedDeclaration> =>
      Arr.getSomes(names.map((name) => path.join(outDir, name)).filter(isDeclarationFile).map((file) => packageDeclarationOf(path, declaredRoot, file))),
  )

const missingEntryDiagnostic = (declarationFile: string): Diagnostic => ({
  _tag: 'Note',
  file: declarationFile,
  message: 'the compiler emitted no declaration for this entry point',
})

const unsupportedImport = (unresolved: UnresolvedImport): UnsupportedDeclaration =>
  new UnsupportedDeclaration({ file: unresolved.file, construct: `the import \`${unresolved.specifier}\` names no declaration file inside the package` })

const handWrittenOr = (source: PackageSource, realRoot: string, emitted: HashMap.HashMap<string, string>) => (declarationFile: string) =>
  Option.match(HashMap.get(emitted, declarationFile), {
    onNone: () => readPackageFile({ packageRoot: source.packageRoot, realRoot, file: declarationFile }),
    onSome: Effect.succeedSome,
  })

const readSource = (
  source: PackageSource,
  realRoot: string,
  candidates: ReadonlyArray<string>,
): Effect.Effect<Option.Option<SourceFile>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Arr.match(candidates, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([candidate, ...rest]) =>
      Effect.flatMap(readPackageFile({ packageRoot: source.packageRoot, realRoot, file: candidate }), (text) =>
        Option.match(text, {
          onNone: () => readSource(source, realRoot, rest),
          onSome: (value) => Effect.succeedSome({ path: candidate, text: value }),
        })),
  })

const sourceFileOf = (
  source: PackageSource,
  realRoot: string,
  emitted: HashMap.HashMap<string, string>,
  file: DeclarationFile,
): Effect.Effect<Option.Option<SourceFile>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  HashMap.has(emitted, file.path)
    ? readSource(source, realRoot, sourceCandidatesOf(file.path))
    : Effect.succeedSome({ path: file.path, text: file.text })

const sourcesOf = (
  source: PackageSource,
  realRoot: string,
  emitted: HashMap.HashMap<string, string>,
  files: ReadonlyArray<DeclarationFile>,
): Effect.Effect<ReadonlyArray<SourceFile>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    Effect.forEach(files, (file) => sourceFileOf(source, realRoot, emitted, file)),
    (sources) => uniqueSources(Arr.getSomes(sources)),
  )

const declarationsOf = (
  source: PackageSource,
  entryPoints: ReadonlyArray<EntryDeclaration>,
  realRoot: string,
  emitted: HashMap.HashMap<string, string>,
  load: (declarationFile: string) => Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<Declarations, UnsupportedDeclaration | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(
    closeDeclarations({
      entryDeclarations: entryPoints.map((entry) => entry.declarationFile),
      load,
    }),
    (report) =>
      Arr.match(report.unresolvedImports, {
        onEmpty: (): Effect.Effect<Declarations, UnsupportedDeclaration | PlatformError, FileSystem.FileSystem | Path.Path> =>
          Effect.map(sourcesOf(source, realRoot, emitted, report.files), (sources) => ({
            producer: TYPESCRIPT_PRODUCER,
            package: { name: source.name, version: source.version },
            anchorBase: source.anchorBase,
            anchorPrefix: source.anchorPrefix,
            entryPoints,
            files: report.files,
            sources,
          })),
        onNonEmpty: ([unresolved]) => Effect.fail(unsupportedImport(unresolved)),
      }),
  )

const handWrittenEntries = (entryPoints: ReadonlyArray<SourceEntryPoint>): HashSet.HashSet<string> =>
  HashSet.fromIterable(entryPoints.filter((entry) => isDeclarationFile(entry.sourceFile)).map((entry) => entry.sourceFile))

const compilerEntryDeclarations = (entryPoints: ReadonlyArray<SourceEntryPoint>): ReadonlyArray<EntryDeclaration> =>
  entryPointDeclarations(entryPoints.filter((entry) => !isDeclarationFile(entry.sourceFile)))

const declarationsFrom = (source: PackageSource, run: CompilerRun) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fileSystem = yield* FileSystem.FileSystem
    const declaredRoot = path.join(run.outDir, path.relative(source.workspaceRoot, source.packageRoot))
    const declared = yield* emittedDeclarationFiles(path, fileSystem, run.outDir, declaredRoot)
    const handWritten = handWrittenEntries(source.entryPoints)
    const emitted = HashMap.filter(
      HashMap.fromIterable(
        yield* Effect.forEach(declared, (declaration) =>
          Effect.map(fileSystem.readFileString(declaration.emittedFile), (text) => [declaration.declared, text] as const),
        ),
      ),
      (_text, declarationFile) => !HashSet.has(handWritten, declarationFile),
    )
    const entryPoints = entryPointDeclarations(source.entryPoints)
    const emittedEntries = compilerEntryDeclarations(source.entryPoints).map((entry) => entry.declarationFile)
    return yield* Arr.match(missingEntryDeclarations(HashSet.fromIterable(HashMap.keys(emitted)), emittedEntries), {
      onEmpty: () => Effect.flatMap(fileSystem.realPath(source.packageRoot), (realRoot) =>
        declarationsOf(source, entryPoints, realRoot, emitted, handWrittenOr(source, realRoot, emitted))),
      onNonEmpty: (missing) => Effect.fail(new CompilerRejected({ diagnostics: missing.map(missingEntryDiagnostic) })),
    })
  })

const accepted = (source: PackageSource, run: CompilerRun) =>
  Option.match(Option.liftPredicate(run.exitCode, (code) => code === 0), {
    onNone: () => refusal(source, run),
    onSome: () => declarationsFrom(source, run),
  })

const missingSourceDiagnostic = (entry: SourceEntryPoint, reason: string): Diagnostic => ({
  _tag: 'Note',
  file: entry.sourceFile,
  message: `the entry point ${entry.exportPath} names the source file ${entry.sourceFile}, which ${reason}`,
})

const entryProblem = (source: PackageSource) =>
  (entry: SourceEntryPoint): Effect.Effect<Option.Option<Diagnostic>, PlatformError, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.realPath(source.packageRoot)
      const resolved = yield* Effect.option(fileSystem.realPath(path.resolve(source.packageRoot, entry.sourceFile)))
      return Option.match(resolved, {
        onNone: () => Option.some(missingSourceDiagnostic(entry, 'does not exist')),
        onSome: (real) =>
          Option.match(relativeWithin(path, root, real), {
            onSome: () => Option.none(),
            onNone: () => Option.some(missingSourceDiagnostic(entry, 'resolves outside the package')),
          }),
      })
    })

const sharedDeclarationDiagnostic = (shared: SharedDeclaration): Diagnostic => ({
  _tag: 'Note',
  file: shared.declarationFile,
  message: `the entry points ${shared.exportPaths.join(ENTRY_SEPARATOR)} share the declaration file ${shared.declarationFile}`,
})

const checked = (source: PackageSource): Effect.Effect<void, CompilerRejected | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const problems = Arr.getSomes(yield* Effect.forEach(source.entryPoints, entryProblem(source)))
    return yield* Arr.match(problems, {
      onEmpty: () =>
        Option.match(Option.map(Arr.head(sharedDeclarations(entryPointDeclarations(source.entryPoints))), sharedDeclarationDiagnostic), {
          onNone: () => Effect.void,
          onSome: (diagnostic) => Effect.fail(new CompilerRejected({ diagnostics: [diagnostic] })),
        }),
      onNonEmpty: (diagnostics) => Effect.fail(new CompilerRejected({ diagnostics })),
    })
  })

const emit = (source: PackageSource, tsc: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* checked(source)
      const run = yield* runCompiler(source, tsc)
      return yield* accepted(source, run)
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
