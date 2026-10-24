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

const typeIncorrectSourcePackage = packageOf(sourceManifest('type-incorrect', './src/mod.ts'), {
  'mod.ts': "export const count: number = 'one'\n",
})

const missingEntrySourcePackage = packageOf(sourceManifest('missing-entry', './src/mod.ts'), {})

const tsxEntryBesideTsPackage = packageOf(sourceManifest('tsx-entry', './src/mod.tsx'), {
  'mod.tsx': 'export const fromTsx: number = 1\n',
  'mod.ts': 'export const fromTs: number = 2\n',
})

const directoryBesideTsxImportPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* packageOf(sourceManifest('directory-import', './src/mod.ts'), {
    'mod.ts': "export { a } from './a.js'\n",
    'a.tsx': 'export const a: number = 1\n',
  })
  yield* fileSystem.makeDirectory(path.join(root, 'src', 'a.ts'))
  return root
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

const missingImportPackage = packageOf(sourceManifest('missing-import', './src/mod.ts'), {
  'mod.ts': "export { thing } from './missing.js'\n",
})

const deletedTsxEntryBesideTsPackage = packageOf(sourceManifest('deleted-tsx-entry', './src/mod.tsx'), {
  'mod.ts': 'export const fromTs: number = 2\n',
})

const sharedDeclarationPathPackage = packageOf(
  {
    name: 'shared-declaration',
    version: '1.0.0',
    exports: {
      '.': { [FrontEnd.FAMILY_SOURCE_CONDITION]: './src/mod.ts' },
      './other': { [FrontEnd.FAMILY_SOURCE_CONDITION]: './src/mod.tsx' },
    },
  },
  { 'mod.ts': 'export const fromTs: number = 2\n', 'mod.tsx': 'export const fromTsx: number = 1\n' },
)

const symlinkedEntryPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-end-symlinked-entry-' })
  const root = path.join(parent, 'package')
  yield* fileSystem.makeDirectory(path.join(root, 'src'), { recursive: true })
  yield* fileSystem.writeFileString(path.join(parent, 'outside.ts'), 'export const outside: number = 1\n')
  yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify(sourceManifest('symlinked-entry', './src/mod.ts')))
  yield* fileSystem.symlink(path.join(parent, 'outside.ts'), path.join(root, 'src', 'mod.ts'))
  return root
})

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
      'a package whose annotated source is type-incorrect takes the fast path, which never type-checks',
      Gherkin.Do.pipe(
        Given("a package exporting `export const count: number = 'one'` from its only source")('packageRoot', () => typeIncorrectSourcePackage),
        When('the engine analyses it')('analysis', (scope) => Effect.flatMap(FrontEnd.readPackage({ packageRoot: scope.packageRoot }), FrontEnd.analyse)),
        Then('the model holds `count` as a constant variable of its annotated type, the value being no concern of the fast path')((scope, expect) =>
          expect({
            route: scope.analysis.route._tag,
            exports: scope.analysis.model.entryPoints.flatMap((entry) => entry.items.map((item) => `${item.kind}:${item.name}`)),
            count: scope.analysis.model.entryPoints.flatMap((entry) => entry.items).find((item) => item.name === 'count' && item.kind === 'variable'),
          }).toEqual({
            route: 'FastPath',
            exports: ['variable:count'],
            count: { kind: 'variable', name: 'count', constant: true, type: { kind: 'keyword', name: 'number' } },
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
        Then('the fast path declines naming the missing declaration file, with no TypeScript code since no compiler reported it')((scope, expect) =>
          expect({ refusal: scope.refusal, message: scope.refusal.message }).toMatchObject({
            refusal: { _tag: 'NotIsolated', diagnostics: [{ file: 'src/mod.d.ts', message: 'no source file inside the package could be read for this entry point' }] },
            message: 'declarations need the type checker:\nsrc/mod.d.ts: no source file inside the package could be read for this entry point',
          })
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
      'an import whose .ts candidate is a directory is read from its .tsx source',
      Gherkin.Do.pipe(
        Given('a package whose entry re-exports `a` from `./a.js`, where `src/a.ts` is a directory beside `src/a.tsx`')('packageRoot', () => directoryBesideTsxImportPackage),
        When('the engine analyses it')('analysis', (scope) => Effect.flatMap(FrontEnd.readPackage({ packageRoot: scope.packageRoot }), FrontEnd.analyse)),
        Then('the fast path models `a` from the .tsx source')((scope, expect) =>
          expect({
            route: scope.analysis.route._tag,
            exports: scope.analysis.model.entryPoints.flatMap((entry) => entry.items.map((item) => `${item.kind}:${item.name}`)),
          }).toEqual({ route: 'FastPath', exports: ['variable:a'] })
        ),
      ),
    )

    scenario(
      'an entry point whose source lies outside the package root is declined by the fast path, as the compiler fallback refuses it',
      Gherkin.Do.pipe(
        Given('a package whose export names `../shared/mod.ts`, a readable file beside the package')('packageRoot', () => entryOutsidePackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the entry declaration file instead of modelling a file outside the package')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'NotIsolated', diagnostics: [{ file: '../shared/mod.d.ts' }] })
        ),
      ),
    )

    scenario(
      'a package whose entry imports a specifier that names no file is declined by the fast path, naming the import',
      Gherkin.Do.pipe(
        Given('a package whose entry re-exports from `./missing.js`, which has no source')('packageRoot', () => missingImportPackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the importing declaration file and the specifier, with no TypeScript code')((scope, expect) =>
          expect({ refusal: scope.refusal, message: scope.refusal.message }).toMatchObject({
            refusal: {
              _tag: 'NotIsolated',
              diagnostics: [{ file: 'src/mod.d.ts', message: 'the import `./missing.js` names no declaration file inside the package' }],
            },
            message: 'declarations need the type checker:\nsrc/mod.d.ts: the import `./missing.js` names no declaration file inside the package',
          })
        ),
      ),
    )

    scenario(
      'an entry point whose source file is deleted is not modelled from a sibling of the same name',
      Gherkin.Do.pipe(
        Given('a package whose export names a `./src/mod.tsx` that is deleted, beside an existing `./src/mod.ts`')('packageRoot', () => deletedTsxEntryBesideTsPackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the missing entry declaration instead of modelling the sibling')((scope, expect) =>
          expect(scope.refusal).toMatchObject({
            _tag: 'NotIsolated',
            diagnostics: [{ file: 'src/mod.d.ts', message: 'no source file inside the package could be read for this entry point' }],
          })
        ),
      ),
    )

    scenario(
      'two entry points that share one declaration file are declined by the fast path',
      Gherkin.Do.pipe(
        Given('a package whose exports name `./src/mod.ts` and `./src/mod.tsx`')('packageRoot', () => sharedDeclarationPathPackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the shared declaration file and both export paths')((scope, expect) =>
          expect(scope.refusal).toMatchObject({
            _tag: 'NotIsolated',
            diagnostics: [{ file: 'src/mod.d.ts', message: 'two entry points share one declaration file: `.` and `./other`' }],
          })
        ),
      ),
    )

    scenario(
      'an entry point whose source is a symlink out of the package is declined by the fast path',
      Gherkin.Do.pipe(
        Given('a package whose `./src/mod.ts` is a symlink to a file outside the package')('packageRoot', () => symlinkedEntryPackage),
        When('its declarations are emitted on the fast path')('refusal', (scope) => Effect.flip(emittedOnFastPath(scope.packageRoot))),
        Then('the fast path declines naming the missing entry declaration instead of reading through the symlink')((scope, expect) =>
          expect(scope.refusal).toMatchObject({
            _tag: 'NotIsolated',
            diagnostics: [{ file: 'src/mod.d.ts', message: 'no source file inside the package could be read for this entry point' }],
          })
        ),
      ),
    )
  })
