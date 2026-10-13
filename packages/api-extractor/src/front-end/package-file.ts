import { Effect, FileSystem, Match, Option, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { relativeWithin } from './declaration-graph.ts'

const DECLARATION_FILE = /\.d\.[cm]?ts$/

export const isDeclarationFile = (file: string): boolean => DECLARATION_FILE.test(file)

const isAbsent = (error: PlatformError): boolean =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', 'BadResource', () => true),
    Match.orElse(() => false),
  )

export type PackageFileRequest = {
  readonly packageRoot: string
  readonly realRoot: string
  readonly file: string
}

export const readPackageFile = (request: PackageFileRequest): Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const real = yield* Effect.option(fileSystem.realPath(path.resolve(request.packageRoot, request.file)))
    return yield* Option.match(Option.flatMap(real, (realFile) => Option.as(relativeWithin(path, request.realRoot, realFile), realFile)), {
      onNone: () => Effect.succeedNone,
      onSome: (realFile) => fileSystem.readFileString(realFile).pipe(Effect.asSome, Effect.catchIf(isAbsent, () => Effect.succeedNone)),
    })
  })
