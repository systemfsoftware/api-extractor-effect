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
        When('the package reader reads both')('refusals', (scope) =>
          Effect.all({ invalidJson: refusalOfReading(scope.invalidJson), refusedManifest: refusalOfReading(scope.refusedManifest) }),
        ),
        Then('each is refused as a rejected manifest, naming its own package root')((scope, expect) =>
          expect(scope.refusals).toMatchObject({
            invalidJson: { _tag: 'ManifestRejected', packageRoot: scope.invalidJson },
            refusedManifest: { _tag: 'ManifestRejected', packageRoot: scope.refusedManifest },
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
  })
