import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Layer, Match, Option, Order, Path, Ref, Result } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { isolatedDeclarationSync } from 'oxc-transform'
import oxcTransformManifest from 'oxc-transform/package.json' with { type: 'json' }
import { closeDeclarations, declarationPathOf, entryPointDeclarations, missingEntryDeclarations, relativeWithin, sourceCandidatesOf, type ClosureResult, type EntryDeclaration, type UnresolvedImport } from './declaration-graph.ts'
import { type DeclarationEmitter, IsolatedEmitter, type IsolatedEmitterId } from './declaration-emitter.service.ts'
import type { DeclarationFile, Declarations, Diagnostic, PackageSource } from './declarations.schema.ts'
import { NotIsolated, type UnsupportedDeclaration } from './front-end-error.schema.ts'

export const OXC_TRANSFORM_PRODUCER: string = `oxc-transform@${oxcTransformManifest.version}`

const DIAGNOSTIC_TEXT = /^TS(\d+): (.*)$/s

const diagnosticOf = (file: string, text: string): Diagnostic =>
  Option.match(Option.fromNullishOr(DIAGNOSTIC_TEXT.exec(text)), {
    onNone: () => ({ file, message: text }),
    onSome: ([, code, message]) => ({ file, code: Number(code), message: message ?? '' }),
  })

const diagnosticOrder: Order.Order<Diagnostic> = Order.combineAll([
  Order.mapInput(Option.makeOrder(Order.String), (diagnostic: Diagnostic) => Option.fromNullishOr(diagnostic.file)),
  Order.mapInput(Option.makeOrder(Order.Number), (diagnostic: Diagnostic) => Option.fromNullishOr(diagnostic.code)),
  Order.mapInput(Order.String, (diagnostic: Diagnostic) => diagnostic.message),
])

const isAbsent = (error: PlatformError): boolean =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', 'BadResource', () => true),
    Match.orElse(() => false),
  )

type Emission = {
  readonly source: PackageSource
  readonly realRoot: string
  readonly diagnostics: Ref.Ref<ReadonlyArray<Diagnostic>>
}

const readSource = (emission: Emission, sourceFile: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const real = yield* Effect.option(fileSystem.realPath(path.resolve(emission.source.packageRoot, sourceFile)))
    return yield* Option.match(real, {
      onNone: () => Effect.succeedNone,
      onSome: (realFile) =>
        Option.match(relativeWithin(path, emission.realRoot, realFile), {
          onNone: () => Effect.succeedNone,
          onSome: () =>
            fileSystem.readFileString(realFile).pipe(
              Effect.asSome,
              Effect.catchIf(isAbsent, () => Effect.succeedNone),
            ),
        }),
    })
  })

const declare = (emission: Emission, sourceFile: string, text: string) =>
  Effect.gen(function* () {
    const result = isolatedDeclarationSync(sourceFile, text, { stripInternal: false, sourcemap: false })
    yield* Ref.update(emission.diagnostics, (known) => [...known, ...result.errors.map((error) => diagnosticOf(sourceFile, error.message))])
    return result.code
  })

const firstSource = (
  emission: Emission,
  candidates: ReadonlyArray<string>,
): Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Arr.match(candidates, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([sourceFile, ...rest]) =>
      Effect.flatMap(readSource(emission, sourceFile), (text) =>
        Option.match(text, {
          onNone: () => firstSource(emission, rest),
          onSome: (value) => Effect.asSome(declare(emission, sourceFile, value)),
        })),
  })

const unresolvedImportDiagnostic = (unresolved: UnresolvedImport): Diagnostic => ({
  file: unresolved.file,
  message: `the import \`${unresolved.specifier}\` names no declaration file inside the package`,
})

const refusedOrClosed = (
  found: ReadonlyArray<Diagnostic>,
  closed: Result.Result<ClosureResult, PlatformError | UnsupportedDeclaration>,
): Effect.Effect<ReadonlyArray<DeclarationFile>, NotIsolated | PlatformError | UnsupportedDeclaration> =>
  Arr.match(found, {
    onEmpty: () =>
      Result.match(closed, {
        onSuccess: (report) =>
          Arr.match(report.unresolvedImports.map(unresolvedImportDiagnostic), {
            onEmpty: () => Effect.succeed(report.files),
            onNonEmpty: (diagnostics) => Effect.fail(new NotIsolated({ diagnostics })),
          }),
        onFailure: Effect.fail,
      }),
    onNonEmpty: (diagnostics) => Effect.fail(new NotIsolated({ diagnostics })),
  })

const missingEntryDiagnostic = (declarationFile: string): Diagnostic => ({
  file: declarationFile,
  message: 'no source file inside the package could be read for this entry point',
})

const everyEntryEmitted = (files: ReadonlyArray<DeclarationFile>, entryDeclarations: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<DeclarationFile>, NotIsolated> =>
  Arr.match(missingEntryDeclarations(HashSet.fromIterable(files.map((file) => file.path)), entryDeclarations), {
    onEmpty: () => Effect.succeed(files),
    onNonEmpty: (missing) => Effect.fail(new NotIsolated({ diagnostics: missing.map(missingEntryDiagnostic) })),
  })

const sharedDeclarationDiagnostic = (declarationFile: string, exportPaths: ReadonlyArray<string>): Diagnostic => ({
  file: declarationFile,
  message: `two entry points share one declaration file: ${exportPaths.map((exportPath) => `\`${exportPath}\``).join(' and ')}`,
})

const sharedDeclarationOwners = (entryPoints: ReadonlyArray<EntryDeclaration>, declarationFile: string): ReadonlyArray<string> =>
  Arr.sort(Arr.map(Arr.filter(entryPoints, (entry) => entry.declarationFile === declarationFile), (entry) => entry.exportPath), Order.String)

const sharedDeclarationDiagnostics = (entryPoints: ReadonlyArray<EntryDeclaration>): ReadonlyArray<Diagnostic> =>
  Arr.dedupe(entryPoints.map((entry) => entry.declarationFile)).flatMap((declarationFile) =>
    Option.match(Option.liftPredicate(sharedDeclarationOwners(entryPoints, declarationFile), (exportPaths) => exportPaths.length > 1), {
      onNone: () => [],
      onSome: (exportPaths) => [sharedDeclarationDiagnostic(declarationFile, exportPaths)],
    }),
  )

const recordedSourceFirst = (recorded: HashMap.HashMap<string, string>) => (declarationFile: string): ReadonlyArray<string> =>
  Option.match(HashMap.get(recorded, declarationFile), {
    onNone: () => sourceCandidatesOf(declarationFile),
    onSome: (sourceFile) => [sourceFile],
  })

const emit = (source: PackageSource) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const realRoot = yield* fileSystem.realPath(source.packageRoot)
    const emission: Emission = { source, realRoot, diagnostics: yield* Ref.make<ReadonlyArray<Diagnostic>>([]) }
    const entryPoints = entryPointDeclarations(source.entryPoints)
    const entryDeclarations = entryPoints.map((entry) => entry.declarationFile)
    yield* Arr.match(sharedDeclarationDiagnostics(entryPoints), {
      onEmpty: () => Effect.void,
      onNonEmpty: (diagnostics) => Effect.fail(new NotIsolated({ diagnostics })),
    })
    const candidatesOf = recordedSourceFirst(HashMap.fromIterable(source.entryPoints.map((entry) => [declarationPathOf(entry.sourceFile), entry.sourceFile] as const)))
    const closed = yield* Effect.result(closeDeclarations({
      entryDeclarations,
      load: (declarationFile) => firstSource(emission, candidatesOf(declarationFile)),
    }))
    const found = Arr.sort(yield* Ref.get(emission.diagnostics), diagnosticOrder)
    const files = yield* everyEntryEmitted(yield* refusedOrClosed(found, closed), entryDeclarations)
    const declarations: Declarations = {
      producer: OXC_TRANSFORM_PRODUCER,
      package: { name: source.name, version: source.version },
      entryPoints,
      files,
    }
    return declarations
  })

export const layer: Layer.Layer<IsolatedEmitterId, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
  IsolatedEmitter,
  Effect.gen(function* () {
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
    const emitter: DeclarationEmitter<NotIsolated> = { emit: (source) => Effect.provideContext(emit(source), services) }
    return emitter
  }),
)
