import { NodeServices } from '@effect/platform-node'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, FileSystem, Layer, Path } from 'effect'

const Feature = makeFeature({ it })

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(Layer.provideMerge(NodeServices.layer))

const STANDALONE_TSCONFIG = {
  compilerOptions: { strict: true, target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', types: [], skipLibCheck: true },
  include: ['src'],
}

const packageWith = (name: string, source: string, compilerOptions: object = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `front-ends-${name}-` })
    yield* fileSystem.makeDirectory(path.join(root, 'src'))
    yield* fileSystem.writeFileString(
      path.join(root, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': { [FrontEnd.FAMILY_SOURCE_CONDITION]: './src/mod.ts' } } }),
    )
    yield* fileSystem.writeFileString(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ ...STANDALONE_TSCONFIG, compilerOptions: { ...STANDALONE_TSCONFIG.compilerOptions, ...compilerOptions } }),
    )
    yield* fileSystem.writeFileString(path.join(root, 'src', 'mod.ts'), source)
    return yield* FrontEnd.readPackage({ packageRoot: root })
  })

const internalExportPackage = packageWith(
  'internal-export',
  'export const shown: number = 1\n/** @internal */\nexport const hidden: number = 2\n',
  { stripInternal: true },
)

const declarationDirPackage = packageWith('declaration-dir', 'export const placed: number = 1\n', { declarationDir: 'types' })

const writtenInto = (source: FrontEnd.PackageSource, directory: string) =>
  Effect.flatMap(Path.Path, (path) => Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.exists(path.join(source.packageRoot, directory))))

const thisPackage = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL('../../../packages/api-extractor', import.meta.url))
  return yield* FrontEnd.readPackage({ packageRoot: root })
})

const analysedThrough = <E, Id>(emitter: Effect.Effect<FrontEnd.DeclarationEmitter<E>, never, Id>, source: FrontEnd.PackageSource) =>
  Effect.gen(function* () {
    const declarations = yield* (yield* emitter).emit(source)
    const model = yield* FrontEnd.buildModel({ ...declarations, producer: 'one producer' })
    return {
      bytes: ApiModel.serialise(model),
      exports: model.entryPoints.flatMap((entry) => entry.items.map((item) => item.name)),
      messages: yield* FrontEnd.resolveMessages(declarations),
      files: declarations.files.map((file) => file.path),
    }
  })

const throughBothRoutes = (source: FrontEnd.PackageSource) =>
  Effect.all({
    isolated: analysedThrough(FrontEnd.IsolatedEmitter, source),
    compiled: analysedThrough(FrontEnd.CompilerEmitter, source),
  })

Feature('Both front-ends reduce a package to one model')
  .withLayer(emitters)
  .live('the compiler fallback runs the TypeScript 7 tsc of this package as a real child process')
  .body(({ scenario }) => {
    scenario(
      'the fast path and the compiler fallback give the same model and messages, whatever the package tsconfig says about @internal or declarationDir',
      Gherkin.Do.pipe(
        Given('this isolatedDeclarations-clean package')('source', () => thisPackage),
        Given('a package whose tsconfig strips @internal and which exports an @internal constant')('internal', () => internalExportPackage),
        Given('a package whose tsconfig sends declarations to `declarationDir: "types"`')('declarationDir', () => declarationDirPackage),
        When('each is analysed through the isolated emitter and through the compiler')('analyses', (scope) =>
          Effect.all({
            ownPackage: throughBothRoutes(scope.source),
            internalExport: throughBothRoutes(scope.internal),
            declarationDir: throughBothRoutes(scope.declarationDir),
            wroteIntoPackage: writtenInto(scope.declarationDir, 'types'),
          })
        ),
        Then('each pair serialises to the same bytes once the producer is set equal, and the compiler writes nothing into the package')((scope, expect) =>
          expect({
            ownPackage: scope.analyses.ownPackage.compiled,
            internalExport: scope.analyses.internalExport.compiled,
            internalExports: scope.analyses.internalExport.isolated.exports,
            declarationDir: scope.analyses.declarationDir.compiled,
            wroteIntoPackage: scope.analyses.wroteIntoPackage,
          }).toEqual({
            ownPackage: scope.analyses.ownPackage.isolated,
            internalExport: scope.analyses.internalExport.isolated,
            internalExports: ['hidden', 'shown'],
            declarationDir: scope.analyses.declarationDir.isolated,
            wroteIntoPackage: false,
          })
        ),
      ),
    )

    scenario(
      'an export with an inferred type routes to the compiler, naming the isolated-declaration diagnostic',
      Gherkin.Do.pipe(
        Given('a package exporting `const ids = [1, 2].map(String)` with no annotation')('source', () =>
          packageWith('inferred-export', 'export const ids = [1, 2].map(String)\n')),
        When('the engine analyses it')('analysis', (scope) => FrontEnd.analyse(scope.source)),
        Then('it took the fallback for TS9010 on `ids` and modelled `ids` as a string array')((scope, expect) =>
          expect({
            route: scope.analysis.route,
            items: scope.analysis.model.entryPoints.flatMap((entry) => entry.items),
          }).toMatchObject({
            route: { _tag: 'Fallback', diagnostics: [{ file: 'src/mod.ts', code: 9010 }] },
            items: [{ kind: 'variable', name: 'ids', constant: true, type: { kind: 'array', element: { kind: 'keyword', name: 'string' } } }],
          })
        ),
      ),
    )

    scenario(
      'a package the compiler rejects is refused with the compiler diagnostic and no model',
      Gherkin.Do.pipe(
        Given('a package that needs the fallback and assigns a string to a number')('source', () =>
          packageWith('type-error', "export const ids = [1, 2].map(String)\nexport const count: number = 'one'\n")),
        When('the engine analyses it')('refusal', (scope) => Effect.flip(FrontEnd.analyse(scope.source))),
        Then('it is refused with TS2322')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'CompilerRejected', diagnostics: [{ file: 'src/mod.ts', code: 2322 }] })
        ),
      ),
    )
  })
