import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Layer, Option, Order, Path, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { API, DiagnosticCategory, type Diagnostic as ApiDiagnostic, type Program } from 'typescript/unstable/async'
import typescriptManifest from 'typescript/package.json' with { type: 'json' }
import { closeDeclarations, entryPointDeclarations, missingEntryDeclarations, relativeWithin, type EntryDeclaration, type UnresolvedImport } from './declaration-graph.ts'
import { CompilerEmitter, type CompilerEmitterId, type DeclarationEmitter } from './declaration-emitter.service.ts'
import type { Declarations, Diagnostic, PackageSource, SourceEntryPoint } from './declarations.schema.ts'
import { CompilerRejected, UnsupportedDeclaration } from './front-end-error.schema.ts'

export const TYPESCRIPT_PRODUCER: string = `typescript@${typescriptManifest.version}`

const TYPESCRIPT_MANIFEST_URL: string = import.meta.resolve('typescript/package.json')

const TSC_SCRIPT: string = typescriptManifest.bin.tsc

const DERIVED_CONFIG_NAME = 'tsconfig.json'

const DECLARATION_FILE = /\.d\.[cm]?ts$/

const KEY_SEPARATOR = '\u0000'

const ENTRY_SEPARATOR = ' and '

export type CompilerEmitPolicy = {
  readonly noEmit: false
  readonly declaration: true
  readonly emitDeclarationOnly: true
  readonly declarationMap: false
  readonly sourceMap: false
  readonly stripInternal: false
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
  removeComments: false,
  incremental: false,
  composite: false,
  tsBuildInfoFile: null,
  rootDir: workspaceRoot,
  outDir,
  declarationDir: outDir,
})

const defaultTypeRoots = (path: Path.Path, directory: string): ReadonlyArray<string> => {
  const parent = path.dirname(directory)
  const typeRoot = path.join(directory, 'node_modules', '@types')
  return parent === directory ? [typeRoot] : [typeRoot, ...defaultTypeRoots(path, parent)]
}

const isStringArray = (value: unknown): value is ReadonlyArray<string> => Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const declaredTypeRoots = (packageRoot: string, tsconfigPath: string): Effect.Effect<Option.Option<ReadonlyArray<string>>> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new API({ cwd: packageRoot })),
    (api) => Effect.map(Effect.promise(() => api.parseConfigFile(tsconfigPath)), (parsed) => Option.liftPredicate(parsed.options['typeRoots'], isStringArray)),
    (api) => Effect.ignoreCause(Effect.promise(() => api.close())),
  ).pipe(Effect.catchCause(() => Effect.succeedNone))

export type DerivedTsconfigRequest = {
  readonly tsconfigPath: string
  readonly packageRoot: string
  readonly workspaceRoot: string
  readonly outDir: string
}

export const derivedTsconfig = (request: DerivedTsconfigRequest): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const typeRoots = Option.getOrElse(yield* declaredTypeRoots(request.packageRoot, request.tsconfigPath), () => defaultTypeRoots(path, request.packageRoot))
    return JSON.stringify({
      extends: request.tsconfigPath,
      compilerOptions: { ...compilerEmitPolicy({ workspaceRoot: request.workspaceRoot, outDir: request.outDir }), typeRoots },
    })
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
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const outDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'api-extractor-tsc-' })
    const derived = path.join(outDir, DERIVED_CONFIG_NAME)
    yield* fileSystem.writeFileString(
      derived,
      yield* derivedTsconfig({ tsconfigPath: source.tsconfigPath, packageRoot: source.packageRoot, workspaceRoot: source.workspaceRoot, outDir }),
    )
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

const exitDiagnostic = (run: CompilerRun): Diagnostic => ({ file: '', message: exitMessage(run.exitCode, run.stdout, run.stderr) })

const indented = (text: string): string => text.replaceAll('\n', '\n  ')

const chainText = (diagnostic: ApiDiagnostic): string =>
  Arr.match(diagnostic.messageChain ?? [], {
    onEmpty: () => diagnostic.text,
    onNonEmpty: (chain) => `${diagnostic.text}\n  ${chain.map((next) => indented(chainText(next))).join('\n  ')}`,
  })

const fileOf = (path: Path.Path, packageRoot: string, fileName: Option.Option<string>): string =>
  Option.getOrElse(
    Option.flatMap(fileName, (name) => relativeWithin(path, packageRoot, path.resolve(packageRoot, name))),
    () => '',
  )

const apiDiagnostic = (path: Path.Path, packageRoot: string, diagnostic: ApiDiagnostic): Diagnostic => ({
  file: fileOf(path, packageRoot, Option.fromNullishOr(diagnostic.fileName)),
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
      Arr.getSomes(names.map((name) => path.join(outDir, name)).filter((file) => DECLARATION_FILE.test(file)).map((file) => packageDeclarationOf(path, declaredRoot, file))),
  )

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
    const declared = yield* emittedDeclarationFiles(path, fileSystem, run.outDir, declaredRoot)
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

const accepted = (source: PackageSource, run: CompilerRun) =>
  Option.match(Option.liftPredicate(run.exitCode, (code) => code === 0), {
    onNone: () => refusal(source, run),
    onSome: () => declarationsFrom(source, run),
  })

const missingSourceDiagnostic = (entry: SourceEntryPoint, reason: string): Diagnostic => ({
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

const sharingEntries = (entries: ReadonlyArray<EntryDeclaration>, declarationFile: string): ReadonlyArray<EntryDeclaration> =>
  entries.filter((entry) => entry.declarationFile === declarationFile)

const sharedDeclarationDiagnostic = (declarationFile: string, entries: ReadonlyArray<EntryDeclaration>): Diagnostic => ({
  file: declarationFile,
  message: `the entry points ${entries.map((entry) => entry.exportPath).join(ENTRY_SEPARATOR)} share the declaration file ${declarationFile}`,
})

const sharedDeclaration = (entries: ReadonlyArray<EntryDeclaration>): Option.Option<Diagnostic> =>
  Option.flatMap(
    Arr.findFirst(
      Arr.sort(Arr.fromIterable(HashSet.fromIterable(entries.map((entry) => entry.declarationFile))), Order.String),
      (declarationFile) => sharingEntries(entries, declarationFile).length > 1,
    ),
    (declarationFile) => Option.some(sharedDeclarationDiagnostic(declarationFile, sharingEntries(entries, declarationFile))),
  )

const checked = (source: PackageSource): Effect.Effect<void, CompilerRejected | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const problems = Arr.getSomes(yield* Effect.forEach(source.entryPoints, entryProblem(source)))
    return yield* Arr.match(problems, {
      onEmpty: () =>
        Option.match(sharedDeclaration(entryPointDeclarations(source.entryPoints)), {
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
