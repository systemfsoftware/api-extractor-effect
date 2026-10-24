import { NodeServices } from '@effect/platform-node'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { builtOf, declarations } from './__fixtures__/declarations.ts'

const Feature = makeFeature({ it })

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(Layer.provideMerge(NodeServices.layer))

const packageOf = (manifest: object, files: Record<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'model-v3-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify(manifest))
    yield* Effect.forEach(Object.entries(files), ([file, text]) =>
      Effect.andThen(
        fileSystem.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }),
        fileSystem.writeFileString(path.join(root, file), text),
      ), { discard: true })
    return root
  })

const sourceManifest = (name: string, exports: object | string) => ({ name, version: '1.0.0', exports })

const analysed = (packageRoot: string) => Effect.flatMap(FrontEnd.readPackage({ packageRoot }), FrontEnd.analyse)

const nestedItems = (items: ReadonlyArray<ApiModel.ApiItem>): ReadonlyArray<ApiModel.ApiItem> =>
  items.flatMap((item) => (item.kind === 'namespace' ? [item, ...nestedItems(item.items)] : [item]))

const itemNamed = (model: ApiModel.ApiModel, name: string) =>
  model.entryPoints.flatMap((entry) => nestedItems(entry.items)).find((item) => item.name === name)

const stringExportsPackage = packageOf(sourceManifest('barrel', './src/mod.ts'), {
  'src/mod.ts': `/**
 * @public
 * @stability stable
 */
export const version: string = '1'

/** @beta */
export interface Options { readonly mode: string }
`,
})

const eagerNamespacePackage = packageOf(sourceManifest('eager', './src/mod.ts'), {
  'src/mod.ts': "export * as NamespaceA from './a.js'\nexport const untagged: number = 1\n",
  'src/a.ts': 'export const listed: number = 1\n',
})

const importsOnlyPackage = packageOf(
  { name: 'app', version: '1.0.0', imports: { '#internal/*': './src/*' } },
  { 'src/queue.ts': 'export const writer: number = 1\n' },
)

Feature('The version 3 model carries anchors, release tags and manifest facts')
  .withLayer(emitters)
  .live('the emitters and the source index read real package files from disk')
  .body(({ scenario }) => {
    scenario(
      'a bare-string exports field resolves `.`, and every item carries its anchor, release tag and stability',
      Gherkin.Do.pipe(
        Given('a package whose `exports` is the string `./src/mod.ts`, exporting a `@public @stability stable` constant and a `@beta` interface')(
          'packageRoot',
          () => stringExportsPackage,
        ),
        When('the engine analyses it')('analysis', (scope) => analysed(scope.packageRoot)),
        Then('`.` names its target, the manifest records it, and each item carries the source facts')((scope, expect) =>
          expect({
            version: scope.analysis.model.schemaVersion,
            anchorBase: scope.analysis.model.anchorBase,
            exports: scope.analysis.model.package.exports,
            targets: scope.analysis.model.entryPoints.map((entry) => entry.target),
            versionItem: itemNamed(scope.analysis.model, 'version'),
            optionsItem: itemNamed(scope.analysis.model, 'Options'),
            coverage: scope.analysis.model.coverage,
          }).toMatchObject({
            version: 3,
            anchorBase: 'package',
            exports: [{ key: '.', target: './src/mod.ts', condition: null }],
            targets: [{ key: '.', condition: null, path: './src/mod.ts' }],
            versionItem: {
              kind: 'variable',
              name: 'version',
              constant: true,
              anchor: { file: 'src/mod.ts', line: 5 },
              releaseTag: 'public',
              stability: 'stable',
            },
            optionsItem: {
              kind: 'interface',
              name: 'Options',
              anchor: { file: 'src/mod.ts', line: 8 },
              releaseTag: 'beta',
              stability: null,
            },
            coverage: { complete: true, reasons: [] },
          })
        ),
      ),
    )

    scenario(
      'a namespace export anchors to its re-export statement, its member anchors to its declaration, and an untagged export carries the missing-tag message at its line',
      Gherkin.Do.pipe(
        Given('a package whose entry re-exports `./a.js` as `NamespaceA` beside an untagged constant')('packageRoot', () => eagerNamespacePackage),
        When('the engine analyses it')('analysis', (scope) => analysed(scope.packageRoot)),
        Then('the namespace anchors to the re-export line, its member and the untagged constant to their own lines, and the message points at the constant')(
          (scope, expect) =>
            expect({
              namespace: itemNamed(scope.analysis.model, 'NamespaceA'),
              member: itemNamed(scope.analysis.model, 'listed'),
              untagged: itemNamed(scope.analysis.model, 'untagged'),
              reasonKinds: scope.analysis.model.coverage.reasons.map((reason) => reason.kind),
              complete: scope.analysis.model.coverage.complete,
              message: scope.analysis.model.messages.find((message) => message.symbol === 'untagged'),
            }).toMatchObject({
              namespace: {
                kind: 'namespace',
                name: 'NamespaceA',
                anchor: { file: 'src/mod.ts', line: 1 },
                releaseTag: 'untagged',
                stability: null,
              },
              member: {
                kind: 'variable',
                name: 'listed',
                anchor: { file: 'src/a.ts', line: 1 },
                releaseTag: 'untagged',
                stability: null,
              },
              untagged: {
                kind: 'variable',
                name: 'untagged',
                anchor: { file: 'src/mod.ts', line: 2 },
                releaseTag: 'untagged',
                stability: null,
              },
              reasonKinds: [],
              complete: true,
              message: {
                messageId: 'ae-missing-release-tag',
                entryPoint: '.',
                item: 'untagged',
                symbol: 'untagged',
                anchor: { file: 'src/mod.ts', line: 2 },
              },
            }),
        ),
      ),
    )

    scenario(
      'a model built from declarations alone leaves every item unanchored and untagged, and says so in the coverage',
      Gherkin.Do.pipe(
        Given('a declaration file exporting one constant')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare const value: number\n']]))),
        When('the model is built from the declarations alone')('model', (scope) => builtOf(scope.declarations)),
        Then('the item is unanchored and untagged, and the coverage carries an unmapped-anchor reason')((scope, expect) =>
          expect({
            item: itemNamed(scope.model, 'value'),
            complete: scope.model.coverage.complete,
            reasons: scope.model.coverage.reasons.map((reason) => reason.kind),
          }).toMatchObject({
            item: { kind: 'variable', name: 'value', anchor: null, releaseTag: 'untagged', stability: null },
            complete: false,
            reasons: ['unmapped-anchor'],
          })),
      ),
    )

    scenario(
      'a package with only an imports map analyses to zero entry points with complete coverage and its imports map recorded',
      Gherkin.Do.pipe(
        Given('an application package whose only surface is `"imports": { "#internal/*": "./src/*" }`')('packageRoot', () => importsOnlyPackage),
        When('the package is read and analysed')('analysis', (scope) =>
          Effect.flatMap(FrontEnd.readPackage({ packageRoot: scope.packageRoot }), (source) =>
            Effect.map(FrontEnd.analyse(source), (analysis) => ({ source, analysis })))),
        Then('it has no entry point, the imports entry as written and a complete declared surface')((scope, expect) =>
          expect({
            entryPoints: scope.analysis.source.entryPoints,
            imports: scope.analysis.source.manifest.imports,
            modelEntryPoints: scope.analysis.analysis.model.entryPoints,
            modelImports: scope.analysis.analysis.model.package.imports,
            coverage: scope.analysis.analysis.model.coverage,
          }).toEqual({
            entryPoints: [],
            imports: [{ key: '#internal/*', target: './src/*', condition: null }],
            modelEntryPoints: [],
            modelImports: [{ key: '#internal/*', target: './src/*', condition: null }],
            coverage: { complete: true, reasons: [] },
          })
        ),
      ),
    )
  })
