import { Array as Arr, Effect, FileSystem, HashMap, HashSet, Layer, Match, Option, Order, Path, Ref, Result } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { isolatedDeclarationSync } from 'oxc-transform'
import oxcTransformManifest from 'oxc-transform/package.json' with { type: 'json' }
import { closeDeclarations, declarationPathOf, sourceCandidatesOf } from './declaration-graph.ts'
import { type DeclarationEmitter, IsolatedEmitter, type IsolatedEmitterId } from './declaration-emitter.service.ts'
import type { DeclarationFile, Declarations, Diagnostic, PackageSource } from './declarations.schema.ts'
import { NotIsolated } from './front-end-error.schema.ts'

export const OXC_TRANSFORM_PRODUCER: string = `oxc-transform@${oxcTransformManifest.version}`

const DIAGNOSTIC_TEXT = /^TS(\d+): (.*)$/s

const diagnosticOf = (file: string, text: string): Diagnostic =>
  Option.match(Option.fromNullishOr(DIAGNOSTIC_TEXT.exec(text)), {
    onNone: () => ({ file, code: 0, message: text }),
    onSome: ([, code, message]) => ({ file, code: Number(code), message: message ?? '' }),
  })

const diagnosticOrder: Order.Order<Diagnostic> = Order.combineAll([
  Order.mapInput(Order.String, (diagnostic: Diagnostic) => diagnostic.file),
  Order.mapInput(Order.Number, (diagnostic: Diagnostic) => diagnostic.code),
  Order.mapInput(Order.String, (diagnostic: Diagnostic) => diagnostic.message),
])

const isAbsent = (error: PlatformError): boolean =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', 'BadResource', () => true),
    Match.orElse(() => false),
  )

type Emission = {
  readonly source: PackageSource
  readonly diagnostics: Ref.Ref<ReadonlyArray<Diagnostic>>
}

const readSource = (packageRoot: string, sourceFile: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* fileSystem.readFileString(path.join(packageRoot, sourceFile)).pipe(
      Effect.asSome,
      Effect.catchIf(isAbsent, () => Effect.succeedNone),
    )
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
      Effect.flatMap(readSource(emission.source.packageRoot, sourceFile), (text) =>
        Option.match(text, {
          onNone: () => firstSource(emission, rest),
          onSome: (value) => Effect.asSome(declare(emission, sourceFile, value)),
        })),
  })

const refusedOrClosed = <A, E>(found: ReadonlyArray<Diagnostic>, closed: Result.Result<A, E>): Effect.Effect<A, NotIsolated | E> =>
  Arr.match(found, {
    onEmpty: () => Result.match(closed, { onSuccess: Effect.succeed, onFailure: Effect.fail }),
    onNonEmpty: (diagnostics) => Effect.fail(new NotIsolated({ diagnostics })),
  })

const missingEntryDiagnostic = (declarationFile: string): Diagnostic => ({
  file: declarationFile,
  code: 0,
  message: 'no source file could be read for this entry point',
})

const missingEntries = (files: ReadonlyArray<DeclarationFile>, entryDeclarations: ReadonlyArray<string>): ReadonlyArray<Diagnostic> => {
  const emitted = HashSet.fromIterable(files.map((file) => file.path))
  return entryDeclarations.filter((declarationFile) => !HashSet.has(emitted, declarationFile)).map(missingEntryDiagnostic)
}

const everyEntryEmitted = (files: ReadonlyArray<DeclarationFile>, entryDeclarations: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<DeclarationFile>, NotIsolated> =>
  Arr.match(missingEntries(files, entryDeclarations), {
    onEmpty: () => Effect.succeed(files),
    onNonEmpty: (diagnostics) => Effect.fail(new NotIsolated({ diagnostics })),
  })

const recordedSourceFirst = (recorded: HashMap.HashMap<string, string>) => (declarationFile: string): ReadonlyArray<string> =>
  Arr.dedupe([...Option.toArray(HashMap.get(recorded, declarationFile)), ...sourceCandidatesOf(declarationFile)])

const emit = (source: PackageSource) =>
  Effect.gen(function* () {
    const emission: Emission = { source, diagnostics: yield* Ref.make<ReadonlyArray<Diagnostic>>([]) }
    const entryPoints = source.entryPoints.map((entry) => ({ exportPath: entry.exportPath, declarationFile: declarationPathOf(entry.sourceFile) }))
    const entryDeclarations = entryPoints.map((entry) => entry.declarationFile)
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
