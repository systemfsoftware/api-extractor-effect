import { NodeServices } from '@effect/platform-node'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, FileSystem, Layer, Match, Option, Path } from 'effect'

const Feature = makeFeature({ it })

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(Layer.provideMerge(NodeServices.layer))

const STANDALONE_TSCONFIG = {
  compilerOptions: { strict: true, target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', types: [], skipLibCheck: true },
  include: ['src'],
}

const SOURCE_CONDITION = FrontEnd.FAMILY_SOURCE_CONDITION

const manifestWith = (name: string, exports: Readonly<Record<string, string>>): string =>
  JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    exports: Object.fromEntries(Object.entries(exports).map(([exportPath, source]) => [exportPath, { [SOURCE_CONDITION]: source }])),
  })

const fallingBackPackage = (name: string, exports: Readonly<Record<string, string>>, files: Readonly<Record<string, string>>, tsconfig?: object) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `front-ends-${name}-` })
    yield* fileSystem.makeDirectory(path.join(root, 'src'))
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), manifestWith(name, exports))
    yield* Effect.forEach(Object.entries(files), ([file, text]) =>
      Effect.andThen(fileSystem.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }), fileSystem.writeFileString(path.join(root, file), text)))
    yield* Option.match(Option.fromNullishOr(tsconfig), {
      onNone: () => Effect.void,
      onSome: (config) => fileSystem.writeFileString(path.join(root, 'tsconfig.json'), JSON.stringify(config)),
    })
    return yield* FrontEnd.readPackage({ packageRoot: root })
  })

const packageWith = (name: string, source: string, compilerOptions: object = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `front-ends-${name}-` })
    yield* fileSystem.makeDirectory(path.join(root, 'src'))
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': { [SOURCE_CONDITION]: './src/mod.ts' } } }))
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

const removeCommentsPackage = packageWith('remove-comments', '/** @public */\nexport const tagged: number = 1\n', { removeComments: true })

const declaredTypeRootsPackage = fallingBackPackage(
  'declared-type-roots',
  { '.': './src/mod.ts' },
  {
    'src/mod.ts': 'export const greeting: Greeting = { text: "hi" }\n',
    'types/greeting/index.d.ts': 'declare interface Greeting { readonly text: string }\n',
    'types/greeting/package.json': JSON.stringify({ name: 'greeting', types: 'index.d.ts' }),
  },
  { ...STANDALONE_TSCONFIG, compilerOptions: { ...STANDALONE_TSCONFIG.compilerOptions, types: ['greeting'], typeRoots: ['./types'] } },
)

const nodeModulesTypesPackage = fallingBackPackage(
  'node-modules-types',
  { '.': './src/mod.ts' },
  {
    'src/mod.ts': 'export const greeting: Greeting = { text: "hi" }\n',
    'node_modules/greeting/package.json': JSON.stringify({ name: 'greeting', version: '1.0.0', exports: { './globals': { types: './globals.d.ts' } } }),
    'node_modules/greeting/globals.d.ts': 'declare interface Greeting { readonly text: string }\n',
  },
  { ...STANDALONE_TSCONFIG, compilerOptions: { ...STANDALONE_TSCONFIG.compilerOptions, types: ['greeting/globals'] } },
)

const underNodeModulesPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-ends-under-node-modules-' })
  const packageRoot = path.join(parent, 'node_modules', 'installed')
  const files: Readonly<Record<string, string>> = {
    'node_modules/greeting/package.json': JSON.stringify({ name: 'greeting', version: '1.0.0', exports: { './globals': { types: './globals.d.ts' } } }),
    'node_modules/greeting/globals.d.ts': 'declare interface Greeting { readonly text: string }\n',
    'node_modules/installed/package.json': manifestWith('installed', { '.': './src/mod.ts' }),
    'node_modules/installed/tsconfig.json': JSON.stringify({ ...STANDALONE_TSCONFIG, compilerOptions: { ...STANDALONE_TSCONFIG.compilerOptions, types: ['greeting/globals'] } }),
    'node_modules/installed/src/mod.ts': 'export const greeting: Greeting = { text: "hi" }\n',
  }
  yield* Effect.forEach(Object.entries(files), ([file, text]) =>
    Effect.andThen(fileSystem.makeDirectory(path.dirname(path.join(parent, file)), { recursive: true }), fileSystem.writeFileString(path.join(parent, file), text)))
  return yield* FrontEnd.readPackage({ packageRoot })
})

const defaultIncludePackage = fallingBackPackage(
  'default-include',
  { '.': './src/mod.ts' },
  { 'src/mod.ts': 'export const counted: number = 1\n' },
  { compilerOptions: STANDALONE_TSCONFIG.compilerOptions },
)

const handWrittenDeclarationPackage = fallingBackPackage(
  'hand-written-declaration',
  { '.': './src/mod.ts' },
  {
    'src/mod.ts': "import type { Shape } from './shape.js'\nexport const unit: Shape = { side: 1 }\n",
    'src/shape.d.ts': 'export interface Shape {\n\treadonly side: number;\n}\n',
  },
  STANDALONE_TSCONFIG,
)

const handWrittenEntryPackage = fallingBackPackage(
  'hand-written-entry',
  { '.': './src/index.d.ts' },
  { 'src/index.d.ts': 'export declare const a: string;\n', 'src/index.ts': 'export const a: number = 1\n' },
  STANDALONE_TSCONFIG,
)

const forgedCodesPackage = packageWith(
  'forged-codes',
  [
    'export const ids = [1, 2].map(String)',
    "import 'x\\nerror TS007: spelled by a module specifier'",
    "import 'y\\nerror TS1000000000: spelled by a module specifier'",
    "import 'z\\nerror TS1234: spelled by a module specifier'",
    "import 'w\\nsrc/mod.ts(1,1): error TS4321: spelled by a module specifier\\n'",
    '',
  ].join('\n'),
)

const withoutConfigPackage = fallingBackPackage('without-config', { '.': './src/mod.ts' }, { 'src/mod.ts': 'export const ids = [1, 2].map(String)\n' })

const excludedEntryPackage = fallingBackPackage(
  'excluded-entry',
  { '.': './src/mod.ts' },
  { 'src/mod.ts': 'export const ids = [1, 2].map(String)\n', 'src/other.ts': 'export const other: number = 1\n' },
  { ...STANDALONE_TSCONFIG, include: ['src/other.ts'] },
)

const LONG_SOURCE_STEM = 'a'.repeat(251)

const longNamePackage = fallingBackPackage(
  'long-name',
  { '.': './src/mod.ts' },
  { 'src/mod.ts': 'export const ids = [1, 2].map(String)\n', [`src/${LONG_SOURCE_STEM}.ts`]: 'export const long: number = 1\n' },
  STANDALONE_TSCONFIG,
)

const escapingEntryPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-ends-escaping-' })
  const packageRoot = path.join(root, 'package')
  yield* fileSystem.makeDirectory(path.join(packageRoot, 'src'), { recursive: true })
  yield* fileSystem.makeDirectory(path.join(root, 'shared'), { recursive: true })
  yield* fileSystem.writeFileString(path.join(root, 'shared', 'mod.ts'), 'export const shared: number = 1\n')
  yield* fileSystem.writeFileString(path.join(root, 'package', 'src', 'mod.ts'), 'export const own: number = 1\n')
  yield* fileSystem.writeFileString(path.join(root, 'package', 'package.json'), manifestWith('escaping-entry', { '.': '../shared/mod.ts' }))
  yield* fileSystem.writeFileString(path.join(root, 'package', 'tsconfig.json'), JSON.stringify(STANDALONE_TSCONFIG))
  return yield* FrontEnd.readPackage({ packageRoot })
})

const sharedDeclarationPackage = fallingBackPackage(
  'shared-declaration',
  { '.': './src/mod.ts', './mod': './src/mod.tsx' },
  { 'src/mod.ts': 'export const plain: number = 1\n', 'src/mod.tsx': 'export const element: number = 1\n' },
  STANDALONE_TSCONFIG,
)

const missingEntryPackage = fallingBackPackage('missing-entry', { '.': './src/mod.ts' }, {}, STANDALONE_TSCONFIG)

type Refused = { readonly message: string; readonly diagnostics?: ReadonlyArray<FrontEnd.Diagnostic> }

const codeOf = (diagnostic: FrontEnd.Diagnostic): number | undefined =>
  Match.value(diagnostic).pipe(
    Match.tag('Reported', (reported) => reported.code),
    Match.tag('Note', () => undefined),
    Match.exhaustive,
  )

const refusalOf = (error: Refused) => {
  const diagnostics = error.diagnostics ?? []
  return {
    error,
    codes: diagnostics.map(codeOf),
    files: diagnostics.map((diagnostic) => diagnostic.file),
    lines: diagnostics.flatMap((diagnostic) => diagnostic.message.split('\n').filter((line) => /error TS\d+/.test(line))),
  }
}

const routedAs = (analysis: FrontEnd.Analysis) => ({
  route: analysis.route,
  declarations: analysis.model.producer.declarations,
  items: analysis.model.entryPoints.flatMap((entry) => entry.items),
})

const STRING_ARRAY_FALLBACK = {
  route: { _tag: 'Fallback', diagnostics: [{ _tag: 'Reported', file: 'src/mod.ts', code: 9010 }] },
  declarations: FrontEnd.TYPESCRIPT_PRODUCER,
  items: [{ kind: 'variable', name: 'ids', constant: true, type: { kind: 'array', element: { kind: 'keyword', name: 'string' } } }],
}

const refusedThrough = (source: FrontEnd.PackageSource) =>
  Effect.gen(function* () {
    const emitter = yield* FrontEnd.CompilerEmitter
    return yield* Effect.flip(emitter.emit(source))
  })

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
      entries: declarations.entryPoints.map((entry) => ({ exportPath: entry.exportPath, declarationFile: entry.declarationFile })),
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
      'the fast path and the compiler fallback give the same model and messages, whatever the package tsconfig says about @internal, comments, declarationDir, type roots, types or included files, wherever the package is installed, and when a source or an entry point names a hand-written declaration file',
      Gherkin.Do.pipe(
        Given('this isolatedDeclarations-clean package')('source', () => thisPackage),
        Given('a package whose tsconfig strips @internal and which exports an @internal constant')('internal', () => internalExportPackage),
        Given('a package whose tsconfig removes comments and which exports a constant tagged @public')('removeComments', () => removeCommentsPackage),
        Given('a package whose tsconfig sends declarations to `declarationDir: "types"`')('declarationDir', () => declarationDirPackage),
        Given('a package whose tsconfig names a global type from its own `typeRoots: ["./types"]`')('typeRoots', () => declaredTypeRootsPackage),
        Given('a package whose tsconfig names a global type from a dependency in its own node_modules, `types: ["greeting/globals"]`')('nodeModulesTypes', () => nodeModulesTypesPackage),
        Given('a package installed under a `node_modules` directory whose tsconfig names a global type from a sibling dependency')('underNodeModules', () => underNodeModulesPackage),
        Given('a package whose tsconfig names no `include`, so every file under it is compiled')('defaultInclude', () => defaultIncludePackage),
        Given('a package whose source imports a type from a hand-written `shape.d.ts` beside it')('handWritten', () => handWrittenDeclarationPackage),
        Given('a package whose entry point names a hand-written `index.d.ts` beside an `index.ts` the compiler also compiles')('handWrittenEntry', () => handWrittenEntryPackage),
        When('each is analysed through the isolated emitter and through the compiler')('analyses', (scope) =>
          Effect.all({
            ownPackage: throughBothRoutes(scope.source),
            internalExport: throughBothRoutes(scope.internal),
            removeComments: throughBothRoutes(scope.removeComments),
            declarationDir: throughBothRoutes(scope.declarationDir),
            typeRoots: throughBothRoutes(scope.typeRoots),
            nodeModulesTypes: throughBothRoutes(scope.nodeModulesTypes),
            underNodeModules: throughBothRoutes(scope.underNodeModules),
            defaultInclude: throughBothRoutes(scope.defaultInclude),
            handWritten: throughBothRoutes(scope.handWritten),
            handWrittenEntry: throughBothRoutes(scope.handWrittenEntry),
            wroteIntoPackage: writtenInto(scope.declarationDir, 'types'),
          })
        ),
        Then('each pair serialises to the same bytes with the same notes once the producer is set equal, and the compiler writes nothing into the package')((scope, expect) =>
          expect({
            ownPackage: scope.analyses.ownPackage.compiled,
            internalExport: scope.analyses.internalExport.compiled,
            internalExports: scope.analyses.internalExport.isolated.exports,
            removeComments: scope.analyses.removeComments.compiled,
            taggedNotes: scope.analyses.removeComments.isolated.messages,
            declarationDir: scope.analyses.declarationDir.compiled,
            typeRoots: scope.analyses.typeRoots.compiled,
            nodeModulesTypes: scope.analyses.nodeModulesTypes.compiled,
            underNodeModules: scope.analyses.underNodeModules.compiled,
            defaultInclude: scope.analyses.defaultInclude.compiled,
            handWritten: scope.analyses.handWritten.compiled,
            handWrittenFiles: scope.analyses.handWritten.compiled.files,
            handWrittenEntry: scope.analyses.handWrittenEntry.compiled,
            handWrittenEntryEntries: scope.analyses.handWrittenEntry.compiled.entries,
            handWrittenEntryExports: scope.analyses.handWrittenEntry.compiled.exports,
            wroteIntoPackage: scope.analyses.wroteIntoPackage,
          }).toEqual({
            ownPackage: scope.analyses.ownPackage.isolated,
            internalExport: scope.analyses.internalExport.isolated,
            internalExports: ['hidden', 'shown'],
            removeComments: scope.analyses.removeComments.isolated,
            taggedNotes: [],
            declarationDir: scope.analyses.declarationDir.isolated,
            typeRoots: scope.analyses.typeRoots.isolated,
            nodeModulesTypes: scope.analyses.nodeModulesTypes.isolated,
            underNodeModules: scope.analyses.underNodeModules.isolated,
            defaultInclude: scope.analyses.defaultInclude.isolated,
            handWritten: scope.analyses.handWritten.isolated,
            handWrittenFiles: ['src/mod.d.ts', 'src/shape.d.ts'],
            handWrittenEntry: scope.analyses.handWrittenEntry.isolated,
            handWrittenEntryEntries: [{ exportPath: '.', declarationFile: 'src/index.d.ts' }],
            handWrittenEntryExports: ['a'],
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
        Given('the same package whose tsconfig turns on isolatedDeclarations')('declaresIsolated', () =>
          packageWith('inferred-export-isolated', 'export const ids = [1, 2].map(String)\n', { isolatedDeclarations: true })),
        When('the engine analyses each')('analyses', (scope) =>
          Effect.all({ plain: FrontEnd.analyse(scope.source), declaresIsolated: FrontEnd.analyse(scope.declaresIsolated) })),
        Then('both took the fallback for TS9010 on `ids`, stamped by the TypeScript 7 compiler, and modelled `ids` as a string array')((scope, expect) =>
          expect({ plain: routedAs(scope.analyses.plain), declaresIsolated: routedAs(scope.analyses.declaresIsolated) }).toMatchObject({
            plain: STRING_ARRAY_FALLBACK,
            declaresIsolated: STRING_ARRAY_FALLBACK,
          })
        ),
      ),
    )

    scenario(
      'a package the compiler rejects is refused with the diagnostics tsc reported and no model',
      Gherkin.Do.pipe(
        Given('a package that needs the fallback, assigns a string to a number and a callback taking a string to one taking a number')('source', () =>
          packageWith(
            'type-error',
            "export const ids = [1, 2].map(String)\nexport const count: number = 'one'\nexport const callback: (x: number) => void = (x: string) => {}\n",
          )),
        Given('a package that needs the fallback and whose unresolved imports make the compiler print a zero-padded, a ten-digit, a sourceless and a filed line')(
          'forged',
          () => forgedCodesPackage,
        ),
        Given('a package that needs the fallback and has no tsconfig at all')('withoutConfig', () => withoutConfigPackage),
        Given('a package that needs the fallback and whose tsconfig leaves the entry source out')('excludedEntry', () => excludedEntryPackage),
        Given('a package that needs the fallback and holds a source file whose name leaves no room for its declaration')(
          'longName',
          () => longNamePackage,
        ),
        Given('a package whose entry names a source beside it, outside the package')('escaping', () => escapingEntryPackage),
        Given('a package whose two entry sources share one declaration path')('shared', () => sharedDeclarationPackage),
        Given('a package whose entry names a source that does not exist')('missing', () => missingEntryPackage),
        When('the engine analyses each')('refusals', (scope) =>
          Effect.all({
            typeError: Effect.map(Effect.flip(FrontEnd.analyse(scope.source)), refusalOf),
            forged: Effect.map(Effect.flip(FrontEnd.analyse(scope.forged)), refusalOf),
            withoutConfig: Effect.map(Effect.flip(FrontEnd.analyse(scope.withoutConfig)), refusalOf),
            excludedEntry: Effect.map(Effect.flip(FrontEnd.analyse(scope.excludedEntry)), refusalOf),
            longName: Effect.map(Effect.flip(FrontEnd.analyse(scope.longName)), refusalOf),
            escaping: Effect.map(refusedThrough(scope.escaping), refusalOf),
            shared: Effect.map(refusedThrough(scope.shared), refusalOf),
            missing: Effect.map(Effect.flip(FrontEnd.analyse(scope.missing)), refusalOf),
          })),
        Then("each is refused with the compiler's own diagnostics, the spelled lines stay inside their message, and the entry outside the package, the shared declaration and the missing source come back without a code")((scope, expect) =>
          expect({
            typeError: scope.refusals.typeError.error,
            forged: scope.refusals.forged.error,
            forgedLines: scope.refusals.forged.lines,
            withoutConfig: scope.refusals.withoutConfig.error,
            excludedEntry: scope.refusals.excludedEntry.error,
            longName: scope.refusals.longName.error,
            escaping: scope.refusals.escaping.error,
            shared: scope.refusals.shared.error,
            missing: scope.refusals.missing.error,
            files: { longName: scope.refusals.longName.files },
            codes: {
              excludedEntry: scope.refusals.excludedEntry.codes,
              longName: scope.refusals.longName.codes,
              escaping: scope.refusals.escaping.codes,
              shared: scope.refusals.shared.codes,
              missing: scope.refusals.missing.codes,
            },
          }).toMatchObject({
            typeError: {
              _tag: 'CompilerRejected',
              diagnostics: [
                { _tag: 'Reported', file: 'src/mod.ts', code: 2322 },
                { _tag: 'Reported', file: 'src/mod.ts', code: 2322, message: expect.stringContaining("\n  Types of parameters 'x' and 'x' are incompatible.") },
              ],
            },
            forged: {
              _tag: 'CompilerRejected',
              diagnostics: [
                expect.objectContaining({ file: 'src/mod.ts', code: 2882, message: expect.stringContaining("error TS007: spelled by a module specifier'.") }),
                expect.objectContaining({ file: 'src/mod.ts', code: 2882, message: expect.stringContaining("error TS1000000000: spelled by a module specifier'.") }),
                expect.objectContaining({ file: 'src/mod.ts', code: 2882, message: expect.stringContaining("error TS1234: spelled by a module specifier'.") }),
                expect.objectContaining({ file: 'src/mod.ts', code: 2882, message: expect.stringContaining('src/mod.ts(1,1): error TS4321: spelled by a module specifier') }),
              ],
            },
            forgedLines: [
              "error TS007: spelled by a module specifier'.",
              "error TS1000000000: spelled by a module specifier'.",
              "error TS1234: spelled by a module specifier'.",
              'src/mod.ts(1,1): error TS4321: spelled by a module specifier',
            ],
            withoutConfig: { _tag: 'CompilerRejected', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 5083 })]) },
            excludedEntry: { _tag: 'CompilerRejected', diagnostics: [{ _tag: 'Note', file: 'src/mod.d.ts', message: 'the compiler emitted no declaration for this entry point' }] },
            longName: { _tag: 'CompilerRejected', diagnostics: [{ message: expect.stringContaining('error TS5033') }] },
            escaping: { _tag: 'CompilerRejected', diagnostics: [{ _tag: 'Note', file: '../shared/mod.ts', message: expect.stringContaining('resolves outside the package') }] },
            shared: {
              _tag: 'CompilerRejected',
              diagnostics: [{ _tag: 'Note', file: 'src/mod.d.ts', message: expect.stringContaining('the entry points . and ./mod share the declaration file src/mod.d.ts') }],
            },
            missing: { _tag: 'CompilerRejected', diagnostics: [{ _tag: 'Note', file: 'src/mod.ts', message: expect.stringContaining('does not exist') }] },
            files: { longName: [undefined] },
            codes: { excludedEntry: [undefined], longName: [undefined], escaping: [undefined], shared: [undefined], missing: [undefined] },
          })
        ),
      ),
    )
  })
