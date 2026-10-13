import { NodeServices } from '@effect/platform-node'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, FileSystem, Layer, Path } from 'effect'

const Feature = makeFeature({ it })

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(Layer.provideMerge(NodeServices.layer))

const packageRoot = Effect.flatMap(Path.Path, (path) => Effect.map(path.fromFileUrl(new URL('..', import.meta.url)), (root) => path.resolve(root)))

const packageOf = (manifest: object, sources: Record<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-end-package-' })
    yield* fileSystem.makeDirectory(path.join(root, 'src'))
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify(manifest))
    yield* Effect.forEach(Object.entries(sources), ([file, text]) => fileSystem.writeFileString(path.join(root, 'src', file), text), { discard: true })
    return root
  })

const sourceManifest = (name: string, entry: string) => ({ name, version: '1.0.0', exports: { '.': { [FrontEnd.FAMILY_SOURCE_CONDITION]: entry } } })

const builtOnlyPackage = packageOf({ name: 'no-source', version: '1.0.0', exports: { '.': { types: './dist/mod.d.ts', default: './dist/mod.js' } } }, {})

const destructuredExportPackage = packageOf(sourceManifest('destructured', './src/mod.ts'), {
  'mod.ts': 'const pair = { a: 1, b: 2 }\nexport const { a, b } = pair\n',
})

const missingEntrySourcePackage = packageOf(sourceManifest('missing-entry', './src/mod.ts'), {})

const tsxEntryBesideTsPackage = packageOf(sourceManifest('tsx-entry', './src/mod.tsx'), {
  'mod.tsx': 'export const fromTsx: number = 1\n',
  'mod.ts': 'export const fromTs: number = 2\n',
})

const entryOutsidePackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-end-escaping-entry-' })
  const root = path.join(parent, 'package')
  yield* fileSystem.makeDirectory(path.join(parent, 'shared'), { recursive: true })
  yield* fileSystem.makeDirectory(root)
  yield* fileSystem.writeFileString(path.join(parent, 'shared', 'mod.ts'), 'export const outside: number = 1\n')
  yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify(sourceManifest('escaping-entry', '../shared/mod.ts')))
  return root
})

const emittedOnFastPath = (packageRoot: string) =>
  Effect.flatMap(FrontEnd.readPackage({ packageRoot }), (source) => Effect.flatMap(FrontEnd.IsolatedEmitter, (emitter) => emitter.emit(source)))

Feature('A package is routed to the front-end its declarations allow')
  .withLayer(emitters)
  .live('the emitters read real package files from disk')
  .body(({ scenario }) => {
    scenario(
      'this isolatedDeclarations-clean package takes the fast path and yields a version 2 model',
      Gherkin.Do.pipe(
        Given('this repository package')('source', () => Effect.flatMap(packageRoot, (root) => FrontEnd.readPackage({ packageRoot: root }))),
        When('the engine analyses it')('analysis', (scope) => FrontEnd.analyse(scope.source)),
        Then('it took the fast path and the model round-trips through the version 2 schema')((scope, expect) =>
          expect({
            route: scope.analysis.route._tag,
            producer: scope.analysis.model.producer.declarations,
            entryPoints: scope.analysis.model.entryPoints.map((entry) => entry.path),
            exports: scope.analysis.model.entryPoints.flatMap((entry) => entry.items.map((item) => `${item.kind}:${item.name}`)),
            decoded: ApiModel.decode(ApiModel.encode(scope.analysis.model)),
          }).toEqual({
            route: 'FastPath',
            producer: FrontEnd.OXC_TRANSFORM_PRODUCER,
            entryPoints: ['.'],
            exports: ['namespace:ApiModel', 'namespace:FrontEnd', 'namespace:Verdict'],
            decoded: scope.analysis.model,
          })
        ),
      ),
    )

    scenario(
      'a package whose exports name no TypeScript source is refused before either emitter runs',
      Gherkin.Do.pipe(
        Given('a package exporting only built files')('packageRoot', () => builtOnlyPackage),
        When('the engine reads it')('refusal', (scope) => Effect.flip(FrontEnd.readPackage({ packageRoot: scope.packageRoot }))),
        Then('it is refused as having no source entry')((scope, expect) => expect(scope.refusal).toMatchObject({ _tag: 'NoSourceEntry' })),
      ),
    )

    scenario(
      'a destructured export, whose isolated declarations do not parse, is sent to the compiler fallback',
      Gherkin.Do.pipe(
        Given('a package exporting `const { a, b } = pair`')('packageRoot', () => destructuredExportPackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines with TS9019 instead of refusing the package')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'NotIsolated', diagnostics: [{ file: 'src/mod.ts', code: 9019 }, { file: 'src/mod.ts', code: 9019 }] })
        ),
      ),
    )

    scenario(
      'an entry point whose source file is missing is declined by the fast path instead of modelled as empty',
      Gherkin.Do.pipe(
        Given('a package whose export names `./src/mod.ts`, which does not exist')('packageRoot', () => missingEntrySourcePackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the missing declaration file')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'NotIsolated', diagnostics: [{ file: 'src/mod.d.ts', code: 0 }] })
        ),
      ),
    )

    scenario(
      'a .tsx entry point is read from its own file, not from a sibling .ts of the same name',
      Gherkin.Do.pipe(
        Given('a package whose export names `./src/mod.tsx` beside a different `./src/mod.ts`')('packageRoot', () => tsxEntryBesideTsPackage),
        When('the engine analyses it')('analysis', (scope) => Effect.flatMap(FrontEnd.readPackage({ packageRoot: scope.packageRoot }), FrontEnd.analyse)),
        Then('the model holds the .tsx entry point\'s export')((scope, expect) =>
          expect({
            route: scope.analysis.route._tag,
            exports: scope.analysis.model.entryPoints.flatMap((entry) => entry.items.map((item) => `${item.kind}:${item.name}`)),
          }).toEqual({ route: 'FastPath', exports: ['variable:fromTsx'] })
        ),
      ),
    )

    scenario(
      'an entry point whose source lies outside the package root is declined by the fast path, as the compiler fallback refuses it',
      Gherkin.Do.pipe(
        Given('a package whose export names `../shared/mod.ts`, a readable file beside the package')('packageRoot', () => entryOutsidePackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the entry declaration file instead of modelling a file outside the package')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'NotIsolated', diagnostics: [{ file: '../shared/mod.d.ts', code: 0 }] })
        ),
      ),
    )
  })
