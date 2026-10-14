import { NodeServices } from '@effect/platform-node'
import { FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, FileSystem, Path } from 'effect'

const Feature = makeFeature({ it })

const condition = FrontEnd.FAMILY_SOURCE_CONDITION

const writeSource = (root: string) =>
  ([file, text]: readonly [string, string]) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const target = path.join(root, file)
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true })
      yield* fileSystem.writeFileString(target, text)
    })

const packageOf = (exports: object, sources: Record<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', exports }))
    yield* Effect.forEach(Object.entries(sources), writeSource(root), { discard: true })
    return root
  })

const entryPointsOf = (packageRoot: string) =>
  Effect.map(FrontEnd.readPackage({ packageRoot }), (source) => source.entryPoints)

const rawPackageOf = (manifest: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
    yield* fileSystem.writeFileString(path.join(root, 'package.json'), manifest)
    return root
  })

const refusalOfReading = (packageRoot: string) => Effect.flip(FrontEnd.readPackage({ packageRoot }))

const commonJsEntryPackage = packageOf(
  { '.': { [condition]: './src/mod.ts' }, './legacy': { [condition]: './src/legacy.cts' } },
  { 'src/mod.ts': 'export const mod: number = 1\n', 'src/legacy.cts': 'export const legacy: number = 1\n' },
)

const patternPackage = packageOf({ './*': { [condition]: './src/*.ts' } }, { 'src/a.ts': '', 'src/b.ts': '', 'src/nested/c.ts': '' })

const loopPatternPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
  yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { './*': { [condition]: './src/*.ts' } } }))
  yield* fileSystem.makeDirectory(path.join(root, 'src'), { recursive: true })
  yield* fileSystem.writeFileString(path.join(root, 'src/a.ts'), '')
  yield* fileSystem.symlink('.', path.join(root, 'src/loop'))
  return root
})

const parentLoopPatternPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
  yield* fileSystem.writeFileString(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { './*': { [condition]: './src/*.ts' } } }))
  yield* fileSystem.makeDirectory(path.join(root, 'src/a/b'), { recursive: true })
  yield* fileSystem.writeFileString(path.join(root, 'src/a/x.ts'), '')
  yield* fileSystem.symlink('..', path.join(root, 'src/a/b/up'))
  return root
})

const explicitOverridePackage = packageOf(
  { './special': { [condition]: './src/b.ts' }, './*': { [condition]: './src/*.ts' } },
  { 'src/a.ts': '', 'src/b.ts': '', 'src/special.ts': '' },
)

const outsidePatternPackage = packageOf({ './*': { [condition]: './src/*.ts' } }, { 'src/a.ts': '', 'other/b.ts': '' })

const nestedPatternPackage = packageOf(
  { './*': { [condition]: './src/*.ts' }, './x/*': { [condition]: './lib/*.ts' } },
  { 'src/x/y.ts': '', 'lib/y.ts': '' },
)

const excludedTargetPackage = packageOf(
  { '.': { [condition]: './src/mod.ts' }, './internal/*': null, './legacy': ['./dist/legacy.js'] },
  { 'src/mod.ts': 'export const mod: number = 1\n' },
)

const rootPatternPackage = packageOf(
  { './*': { [condition]: './*.ts' } },
  { 'mod.ts': '', 'node_modules/dep/index.ts': '' },
)

const suffixlessPatternPackage = packageOf(
  { './*': { [condition]: './src/*' } },
  { 'src/mod.ts': '', 'src/data.json': '{}\n', 'src/sub/x.ts': '' },
)

const dotSegmentPatternPackage = packageOf(
  { '.': { [condition]: './entry.ts' }, './*': { [condition]: './src/*.ts' } },
  { 'entry.ts': '', 'src/a.ts': '', 'src/..ts': '', 'src/...ts': '' },
)

const starlessPatternTargetPackage = packageOf(
  { '.': { [condition]: './entry.ts' }, './*': { [condition]: './src/plain.ts' } },
  { 'entry.ts': '', 'src/plain.ts': '' },
)

const twoStarPatternTargetPackage = packageOf(
  { '.': { [condition]: './entry.ts' }, './*': { [condition]: './src/*/*.ts' } },
  { 'entry.ts': '', 'src/a/b.ts': '' },
)

const aliasedSiblingPatternPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
  yield* fileSystem.writeFileString(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { './*': { [condition]: './src/*.ts' } } }),
  )
  yield* writeSource(root)(['src/a/x.ts', ''])
  yield* fileSystem.symlink('a', path.join(root, 'src', 'b'))
  return root
})

const ALIAS_DEPTH = 10

const aliasFanOutPackage = (target: string, fanOutDirectory: string, sources: Record<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* packageOf({ './*': { [condition]: target } }, sources)
    const levels = Array.from({ length: ALIAS_DEPTH }, (_, depth) => path.join(root, fanOutDirectory, ...Array.from({ length: depth }, () => 'a')))
    yield* Effect.forEach(levels, (level) =>
      Effect.andThen(fileSystem.makeDirectory(path.join(level, 'a'), { recursive: true }), fileSystem.symlink('a', path.join(level, 'b'))), { discard: true })
    return root
  })

const escapingPatternPackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outsideRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
  const root = path.join(outsideRoot, 'pkg')
  yield* fileSystem.makeDirectory(root, { recursive: true })
  yield* fileSystem.writeFileString(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { './*': { [condition]: '../outside/*.ts' } } }),
  )
  yield* writeSource(outsideRoot)(['outside/a.ts', ''])
  return root
})

const rootWithoutManifest = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-' })
})

const workspacePackageOf = (name: string, configFile: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'package-reader-workspace-' })
    yield* fileSystem.writeFileString(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packs/*\n')
    const packageRoot = path.join(workspaceRoot, 'packs', name)
    yield* fileSystem.makeDirectory(packageRoot, { recursive: true })
    yield* fileSystem.writeFileString(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { '.': { [condition]: './src/mod.ts' } } }),
    )
    yield* fileSystem.writeFileString(path.join(packageRoot, configFile), '{}\n')
    yield* writeSource(packageRoot)(['src/mod.ts', 'export const mod: number = 1\n'])
    return { packageRoot, workspaceRoot, tsconfigPath: path.join(packageRoot, configFile) }
  })

Feature("A package's exports name its entry points")
  .withLayer(NodeServices.layer)
  .live('the package reader reads real files from disk')
  .body(({ scenario }) => {
    scenario(
      'a package whose exports name a .cts entry beside a .ts one reads both entry points',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/mod.ts` at `.` and `./src/legacy.cts` at `./legacy`')('packageRoot', () => commonJsEntryPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('both sources are read, `.` from the `.ts` file and `./legacy` from the `.cts` file')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: '.', sourceFile: 'src/mod.ts' },
            { exportPath: './legacy', sourceFile: 'src/legacy.cts' },
          ])
        ),
      ),
    )

    scenario(
      'a package whose exports name hand-written declaration files reads them as entry points',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/index.d.ts` at `.`, `./src/legacy.d.cts` at `./legacy` and `./src/modern.d.mts` at `./modern`')('packageRoot', () =>
          packageOf(
            { '.': { [condition]: './src/index.d.ts' }, './legacy': { [condition]: './src/legacy.d.cts' }, './modern': { [condition]: './src/modern.d.mts' } },
            {
              'src/index.d.ts': 'export declare const a: number\n',
              'src/legacy.d.cts': 'export declare const b: number\n',
              'src/modern.d.mts': 'export declare const c: number\n',
            },
          )),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('each declaration file, `.d.ts` and `.d.mts` alike, is its own entry source in export path order')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: '.', sourceFile: 'src/index.d.ts' },
            { exportPath: './legacy', sourceFile: 'src/legacy.d.cts' },
            { exportPath: './modern', sourceFile: 'src/modern.d.mts' },
          ])
        ),
      ),
    )

    scenario(
      'a pattern export expands to one entry per source file under the target directory',
      Gherkin.Do.pipe(
        Given('a package exporting every `./src/<name>.ts` through `"./*"`')('packageRoot', () => patternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('one entry is read per matching source, the `*` taking the nested name whole')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: './a', sourceFile: 'src/a.ts' },
            { exportPath: './b', sourceFile: 'src/b.ts' },
            { exportPath: './nested/c', sourceFile: 'src/nested/c.ts' },
          ])
        ),
      ),
    )

    scenario(
      'a pattern export walks a self-referential symlinked directory only once',
      Gherkin.Do.pipe(
        Given('a package exporting every `./src/<name>.ts` through `"./*"` where `src/loop` is a symlink back to `src`')('packageRoot', () => loopPatternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only the real source is read, the symlink loop contributing no entry')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './a', sourceFile: 'src/a.ts' }])
        ),
      ),
    )

    scenario(
      'a pattern export walks a symlinked directory pointing at an ancestor two levels up only once',
      Gherkin.Do.pipe(
        Given('a package exporting every `./src/<name>.ts` through `"./*"` where `src/a/b/up` is a symlink back to `src/a`')('packageRoot', () => parentLoopPatternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only the real source is read, the upward symlink contributing no entry')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './a/x', sourceFile: 'src/a/x.ts' }])
        ),
      ),
    )

    scenario(
      'a pattern export walks a directory symlinked to a sibling under the alias name as well',
      Gherkin.Do.pipe(
        Given('a package exporting every `./src/<name>.ts` through `"./*"` where `src/b` is a symlink to its sibling `src/a`')('packageRoot', () => aliasedSiblingPatternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('the sibling directory is walked under both its real name and its alias')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: './a/x', sourceFile: 'src/a/x.ts' },
            { exportPath: './b/x', sourceFile: 'src/b/x.ts' },
          ])
        ),
      ),
    )

    scenario(
      'an explicit subpath beats the pattern expansion of the same export path',
      Gherkin.Do.pipe(
        Given('a package exporting `./special` from `./src/b.ts` and every other `./src/<name>.ts` through `"./*"`')('packageRoot', () => explicitOverridePackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('`./special` reads from the explicit source rather than the pattern match of the same export path')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: './a', sourceFile: 'src/a.ts' },
            { exportPath: './b', sourceFile: 'src/b.ts' },
            { exportPath: './special', sourceFile: 'src/b.ts' },
          ])
        ),
      ),
    )

    scenario(
      'a file outside the pattern target directory is not an entry point',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/<name>.ts` through `"./*"` while `./other/b.ts` also exists')('packageRoot', () => outsidePatternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only the source under the target directory is read')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './a', sourceFile: 'src/a.ts' }])
        ),
      ),
    )

    scenario(
      'between two patterns the one with the longer key prefix wins the shared export path',
      Gherkin.Do.pipe(
        Given('a package exporting `./*` from `./src/*.ts` and `./x/*` from `./lib/*.ts`')('packageRoot', () => nestedPatternPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('the shared `./x/y` entry reads from the longer-prefixed pattern')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './x/y', sourceFile: 'lib/y.ts' }])
        ),
      ),
    )

    scenario(
      'a null or array export target is skipped, and the package is still read',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/mod.ts` at `.`, excluding `./internal/*` with null and listing `./legacy` as a fallback array')('packageRoot', () => excludedTargetPackage),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only the `.` entry is read')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: '.', sourceFile: 'src/mod.ts' }])
        ),
      ),
    )

    scenario(
      'a pattern export reads only TypeScript sources, and never a match through node_modules',
      Gherkin.Do.pipe(
        Given('a package exporting `./<name>.ts` through `"./*"` with a `node_modules` dependency inside it')('rootPattern', () => rootPatternPackage),
        Given('a package exporting every `./src/<name>` through `"./*"` beside a JSON file and a directory')('suffixless', () => suffixlessPatternPackage),
        When('the package reader reads both')('entryPoints', (scope) =>
          Effect.all({ rootPattern: entryPointsOf(scope.rootPattern), suffixless: entryPointsOf(scope.suffixless) })),
        Then('each reads only its TypeScript sources inside the package')((scope, expect) =>
          expect(scope.entryPoints).toEqual({
            rootPattern: [{ exportPath: './mod', sourceFile: 'mod.ts' }],
            suffixless: [{ exportPath: './mod.ts', sourceFile: 'src/mod.ts' }, { exportPath: './sub/x.ts', sourceFile: 'src/sub/x.ts' }],
          })
        ),
      ),
    )

    scenario(
      'a package whose manifest does not decode is refused, naming its package root',
      Gherkin.Do.pipe(
        Given('a package whose manifest file is not valid JSON')('invalidJson', () => rawPackageOf('{ not json')),
        Given('a package whose manifest records an export target that is not a path, list or condition map')('refusedManifest', () =>
          rawPackageOf(JSON.stringify({ name: 'fixture', version: '1.0.0', exports: 42 })),
        ),
        Given('a package root holding no manifest file at all')('missingManifest', () => rootWithoutManifest),
        When('the package reader reads all three')('refusals', (scope) =>
          Effect.all({
            invalidJson: refusalOfReading(scope.invalidJson),
            refusedManifest: refusalOfReading(scope.refusedManifest),
            missingManifest: refusalOfReading(scope.missingManifest),
          }),
        ),
        Then('the two undecodable manifests are refused as rejected manifests naming their package roots, while the missing manifest fails the platform read instead')(
          (scope, expect) =>
            expect(scope.refusals).toMatchObject({
              invalidJson: { _tag: 'ManifestRejected', packageRoot: scope.invalidJson },
              refusedManifest: { _tag: 'ManifestRejected', packageRoot: scope.refusedManifest },
              missingManifest: { _tag: 'PlatformError' },
            }),
        ),
      ),
    )

    scenario(
      'a manifest that omits `version` or `name` is refused as a rejected manifest, naming its package root',
      Gherkin.Do.pipe(
        Given('a package whose manifest names a source entry but holds no `version`')('withoutVersion', () =>
          rawPackageOf(JSON.stringify({ name: 'fixture', exports: { '.': { [condition]: './src/mod.ts' } } }))),
        Given('a package whose manifest names a source entry but holds no `name`')('withoutName', () =>
          rawPackageOf(JSON.stringify({ version: '1.0.0', exports: { '.': { [condition]: './src/mod.ts' } } }))),
        When('the package reader reads both')('refusals', (scope) =>
          Effect.all({ withoutVersion: refusalOfReading(scope.withoutVersion), withoutName: refusalOfReading(scope.withoutName) })),
        Then('each is refused as a rejected manifest naming its package root')(
          (scope, expect) =>
            expect(scope.refusals).toMatchObject({
              withoutVersion: { _tag: 'ManifestRejected', packageRoot: scope.withoutVersion },
              withoutName: { _tag: 'ManifestRejected', packageRoot: scope.withoutName },
            }),
        ),
      ),
    )

    scenario(
      'a pattern export whose symlinked aliases fan out past the walk bound is refused, naming the export',
      Gherkin.Do.pipe(
        Given(`a package exporting every \`./src/<name>.ts\` through \`"./*"\`, where each of ${ALIAS_DEPTH} nested directories holds \`a\` and a symlink \`b\` to it`)(
          'packageRoot',
          () => aliasFanOutPackage('./src/*.ts', 'src', {}),
        ),
        When('the package reader reads it')('refusal', (scope) => refusalOfReading(scope.packageRoot)),
        Then('it is refused as a rejected manifest naming the package root and the `./*` export')((scope, expect) =>
          expect(scope.refusal).toMatchObject({
            _tag: 'ManifestRejected',
            packageRoot: scope.packageRoot,
            issue: 'the pattern export "./*" reaches more than 1024 directories',
          })),
      ),
    )

    scenario(
      'a pattern export never walks into node_modules, however its symlinks fan out',
      Gherkin.Do.pipe(
        Given(`a package exporting every \`./<name>.ts\` through \`"./*"\`, whose \`node_modules/dep\` holds ${ALIAS_DEPTH} nested directories each with \`a\` and a symlink \`b\` to it`)(
          'packageRoot',
          () => aliasFanOutPackage('./*.ts', 'node_modules/dep', { 'mod.ts': '' }),
        ),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only the package\'s own source is an entry point')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './mod', sourceFile: 'mod.ts' }])),
      ),
    )

    scenario(
      'a pattern export prunes a node_modules directory nested under its pattern prefix',
      Gherkin.Do.pipe(
        Given(`a package exporting every \`./src/<name>.ts\` through \`"./*"\`, whose \`src/node_modules/dep\` holds ${ALIAS_DEPTH} nested directories each with \`a\` and a symlink \`b\` to it`)(
          'packageRoot',
          () => aliasFanOutPackage('./src/*.ts', 'src/node_modules/dep', { 'src/mod.ts': '' }),
        ),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('the nested fan-out is pruned and only the package\'s own source is an entry point')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './mod', sourceFile: 'src/mod.ts' }])),
      ),
    )

    scenario(
      'an export path takes its entry only from the pattern key Node picks for it, even when that key names no file',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/*.ts` at `"./*"`, `./vendor/*.ts` at `"./a/*"` and null at `"./internal/*"`, with `src/a/x.ts`, `src/b.ts`, `src/internal/z.ts` and `vendor/y.ts`')(
          'packageRoot',
          () =>
            packageOf(
              { './*': { [condition]: './src/*.ts' }, './a/*': { [condition]: './vendor/*.ts' }, './internal/*': null },
              { 'src/a/x.ts': '', 'src/b.ts': '', 'src/internal/z.ts': '', 'vendor/y.ts': '' },
            ),
        ),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('`./a/x` and `./internal/z` name no entry, since their winning keys resolve no source, while `./a/y` and `./b` do')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: './a/y', sourceFile: 'vendor/y.ts' },
            { exportPath: './b', sourceFile: 'src/b.ts' },
          ])),
      ),
    )

    scenario(
      'an export key holding two stars names no entry point',
      Gherkin.Do.pipe(
        Given('a package exporting `./src/mod.ts` at `.` and `./src/*.ts` at `"./*/*.ts"`, with `src/b.ts`')('packageRoot', () =>
          packageOf({ '.': { [condition]: './src/mod.ts' }, './*/*.ts': { [condition]: './src/*.ts' } }, { 'src/mod.ts': '', 'src/b.ts': '' })),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('only `.` is an entry point, and no export path holds a star')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: '.', sourceFile: 'src/mod.ts' }])),
      ),
    )

    scenario(
      'a pattern whose star sits inside a file name walks only directories its prefix can lead to',
      Gherkin.Do.pipe(
        Given(`a package exporting \`./src<name>.ts\` through \`"./*"\`, with \`srcA.ts\` beside a \`node_modules/dep\` holding ${ALIAS_DEPTH} nested directories each with \`a\` and a symlink \`b\` to it`)(
          'packageRoot',
          () => aliasFanOutPackage('./src*.ts', 'node_modules/dep', { 'srcA.ts': '' }),
        ),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('`node_modules` is never walked and `./A` is the one entry point')((scope, expect) =>
          expect(scope.entryPoints).toEqual([{ exportPath: './A', sourceFile: 'srcA.ts' }])),
      ),
    )

    scenario(
      'a package whose exports is a bare path or absent names no source entry',
      Gherkin.Do.pipe(
        Given('a package whose `exports` is the string `./src/mod.ts`')('stringExports', () =>
          rawPackageOf(JSON.stringify({ name: 'fixture', version: '1.0.0', exports: './src/mod.ts' })),
        ),
        Given('a package with no `exports` field')('absentExports', () => rawPackageOf(JSON.stringify({ name: 'fixture', version: '1.0.0' }))),
        Given('a package whose `exports` maps `.` straight to the path `./src/mod.ts`, with no source condition')('bareSubpathTarget', () =>
          rawPackageOf(JSON.stringify({ name: 'fixture', version: '1.0.0', exports: { '.': './src/mod.ts' } })),
        ),
        When('the package reader reads all three')('refusals', (scope) =>
          Effect.all({
            stringExports: refusalOfReading(scope.stringExports),
            absentExports: refusalOfReading(scope.absentExports),
            bareSubpathTarget: refusalOfReading(scope.bareSubpathTarget),
          }),
        ),
        Then('each is refused as having no source entry, naming its own package root')((scope, expect) =>
          expect(scope.refusals).toMatchObject({
            stringExports: { _tag: 'NoSourceEntry', packageRoot: scope.stringExports },
            absentExports: { _tag: 'NoSourceEntry', packageRoot: scope.absentExports },
            bareSubpathTarget: { _tag: 'NoSourceEntry', packageRoot: scope.bareSubpathTarget },
          }),
        ),
      ),
    )

    scenario(
      'a caller may name another source condition, and the reader follows only that one',
      Gherkin.Do.pipe(
        Given('a package whose `.` entry names `./src/mod.ts` under the family condition and `./src/other.ts` under a `development` condition')(
          'packageRoot',
          () =>
            packageOf(
              { '.': { [condition]: './src/mod.ts', development: './src/other.ts' } },
              { 'src/mod.ts': 'export const mod: number = 1\n', 'src/other.ts': 'export const other: number = 1\n' },
            ),
        ),
        When('the package reader reads it once with the default condition and once with `development`')('entryPoints', (scope) =>
          Effect.all({
            family: entryPointsOf(scope.packageRoot),
            development: Effect.map(FrontEnd.readPackage({ packageRoot: scope.packageRoot, sourceCondition: 'development' }), (source) => source.entryPoints),
          })),
        Then('each read takes the source its condition names')((scope, expect) =>
          expect(scope.entryPoints).toEqual({
            family: [{ exportPath: '.', sourceFile: 'src/mod.ts' }],
            development: [{ exportPath: '.', sourceFile: 'src/other.ts' }],
          })
        ),
      ),
    )

    scenario(
      'a pattern export whose matched name holds a dot segment, or whose target is not a single-star pattern, names no entry point',
      Gherkin.Do.pipe(
        Given('a package exporting `./entry.ts` at `.` and, through `"./*"`, every `./src/<name>.ts` beside files whose names leave a `.` and a `..` export-name segment')(
          'dotSegment',
          () => dotSegmentPatternPackage,
        ),
        Given('a package whose `"./*"` target `./src/plain.ts` holds no `*`')('starlessTarget', () => starlessPatternTargetPackage),
        Given('a package whose `"./*"` target `./src/*/*.ts` holds two `*`')('twoStarTarget', () => twoStarPatternTargetPackage),
        When('the package reader reads all three')('entryPoints', (scope) =>
          Effect.all({
            dotSegment: entryPointsOf(scope.dotSegment),
            starlessTarget: entryPointsOf(scope.starlessTarget),
            twoStarTarget: entryPointsOf(scope.twoStarTarget),
          })),
        Then('each reads only the entries whose export name is one real path segment')((scope, expect) =>
          expect(scope.entryPoints).toEqual({
            dotSegment: [{ exportPath: '.', sourceFile: 'entry.ts' }, { exportPath: './a', sourceFile: 'src/a.ts' }],
            starlessTarget: [{ exportPath: '.', sourceFile: 'entry.ts' }],
            twoStarTarget: [{ exportPath: '.', sourceFile: 'entry.ts' }],
          })
        ),
      ),
    )

    scenario(
      'a pattern export names a file whose name holds dollar signs exactly as the file is named',
      Gherkin.Do.pipe(
        Given('a package exporting every `./src/<name>.ts` through `"./*"`, with files `a$$b.ts` and `c$&d.ts`')('packageRoot', () =>
          packageOf({ './*': { [condition]: './src/*.ts' } }, { 'src/a$$b.ts': '', 'src/c$&d.ts': '' })),
        When('the package reader reads its entry points')('entryPoints', (scope) => entryPointsOf(scope.packageRoot)),
        Then('each export name is the file name, dollar signs and all')((scope, expect) =>
          expect(scope.entryPoints).toEqual([
            { exportPath: './a$$b', sourceFile: 'src/a$$b.ts' },
            { exportPath: './c$&d', sourceFile: 'src/c$&d.ts' },
          ])
        ),
      ),
    )

    scenario(
      'a pattern export whose target escapes the package root names no entry point',
      Gherkin.Do.pipe(
        Given('a package whose `"./*"` target points at `../outside/*.ts` beside it, where `../outside/a.ts` exists')('packageRoot', () =>
          escapingPatternPackage),
        When('the package reader reads it')('refusal', (scope) => refusalOfReading(scope.packageRoot)),
        Then('it is refused as having no source entry, naming its package root')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'NoSourceEntry', packageRoot: scope.packageRoot })
        ),
      ),
    )

    scenario(
      'the package reader reports the workspace root above the package and its build config when it holds one',
      Gherkin.Do.pipe(
        Given('a workspace directory holding `pnpm-workspace.yaml`, with a package two levels below it holding its own `tsconfig.build.json`')(
          'withBuildConfig',
          () => workspacePackageOf('with-build-config', 'tsconfig.build.json'),
        ),
        Given('another workspace directory holding `pnpm-workspace.yaml`, with a package two levels below it holding only a `tsconfig.json`')(
          'withDefaultConfig',
          () => workspacePackageOf('with-default-config', 'tsconfig.json'),
        ),
        When('the package reader reads both')('sources', (scope) =>
          Effect.all({
            withBuildConfig: FrontEnd.readPackage({ packageRoot: scope.withBuildConfig.packageRoot }),
            withDefaultConfig: FrontEnd.readPackage({ packageRoot: scope.withDefaultConfig.packageRoot }),
          })),
        Then('each names the workspace root two levels above it and its own build config, or its `tsconfig.json`')((scope, expect) =>
          expect(scope.sources).toEqual({
            withBuildConfig: {
              name: 'fixture',
              version: '1.0.0',
              packageRoot: scope.withBuildConfig.packageRoot,
              workspaceRoot: scope.withBuildConfig.workspaceRoot,
              tsconfigPath: scope.withBuildConfig.tsconfigPath,
              entryPoints: [{ exportPath: '.', sourceFile: 'src/mod.ts' }],
            },
            withDefaultConfig: {
              name: 'fixture',
              version: '1.0.0',
              packageRoot: scope.withDefaultConfig.packageRoot,
              workspaceRoot: scope.withDefaultConfig.workspaceRoot,
              tsconfigPath: scope.withDefaultConfig.tsconfigPath,
              entryPoints: [{ exportPath: '.', sourceFile: 'src/mod.ts' }],
            },
          })
        ),
      ),
    )
  })
