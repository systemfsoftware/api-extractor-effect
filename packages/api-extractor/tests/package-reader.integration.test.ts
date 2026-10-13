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
  })
