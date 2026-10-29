import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { type ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Array as Arr, Duration, Effect, FileSystem, Layer, Option, Order, Path, Result, Schema, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { createRequire } from 'node:module'
import os from 'node:os'
import { parseSync } from 'oxc-parser'
import { isolatedDeclarationSync } from 'oxc-transform'
import ts59 from 'typescript-5.9'

const WARM_RUNS = 5
const require = createRequire(import.meta.url)

const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/

const ConditionMap = Schema.Record(Schema.String, Schema.Json)

const isConditionMap = Schema.is(ConditionMap)

const ExportTarget = Schema.Union([Schema.String, Schema.Null, Schema.Array(Schema.Json), ConditionMap])

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  private: Schema.optionalKey(Schema.Boolean),
  exports: Schema.optionalKey(Schema.Record(Schema.String, ExportTarget)),
})
type Manifest = typeof Manifest.Type

type ProfileError = PlatformError | Schema.SchemaError | UsageError | GitError

class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()('UsageError', { usage: Schema.String }) {}

class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()('GitError', { args: Schema.Array(Schema.String), exitCode: Schema.Int, stderr: Schema.String }) {
  override get message(): string {
    return `git ${this.args.join(' ')} exited with code ${this.exitCode}: ${this.stderr}`
  }
}

interface Subject {
  readonly origin: 'systemfsoftware' | 'api-extractor-effect'
  readonly root: string
  readonly workspaceRoot: string
}

interface Timing {
  readonly coldMs: number
  readonly warmMedianMs: number
}

interface Emit {
  readonly diagnostics: number
  readonly outputs: ReadonlyMap<string, string>
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = Arr.sort(values, Order.Number)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const round = (ms: number): number => Math.round(ms * 100) / 100

const measure = <A, E, R>(effect: Effect.Effect<A, E, R>, runs: number = WARM_RUNS) =>
  Effect.gen(function* () {
    const [cold, result] = yield* Effect.timed(effect)
    const warm = yield* Effect.forEach(Array.from({ length: runs }), () => Effect.map(Effect.timed(effect), ([duration]) => Duration.toMillis(duration)))
    const timing: Timing = { coldMs: round(Duration.toMillis(cold)), warmMedianMs: round(runs === 0 ? Duration.toMillis(cold) : median(warm)) }
    return { result, timing }
  })

const sourceEntryOf = (target: typeof ExportTarget.Type): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(target, isConditionMap), (conditions) =>
    Option.fromNullishOr(conditions[FrontEnd.FAMILY_SOURCE_CONDITION]).pipe(Option.filter((value): value is string => typeof value === 'string' && TYPESCRIPT_SOURCE.test(value))))

const entrySources = (manifest: Manifest): ReadonlyArray<string> =>
  Arr.getSomes(Object.entries(manifest.exports ?? {}).filter(([key]) => key !== './package.json').map(([, target]) => sourceEntryOf(target)))

const readManifest = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fileSystem.readFileString(path.join(root, 'package.json'))
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(text)
  })

const RELATIVE = /^\.\.?\//

const specifiersOf = (file: string, text: string): ReadonlyArray<string> => {
  const { module } = parseSync(file, text)
  return [...module.staticImports.map((entry) => entry.moduleRequest.value), ...module.staticExports.flatMap((entry) => entry.entries.flatMap((item) => (item.moduleRequest === null ? [] : [item.moduleRequest.value])))]
    .filter((specifier) => RELATIVE.test(specifier))
}

const candidatesFor = (base: string): ReadonlyArray<string> =>
  TYPESCRIPT_SOURCE.test(base) ? [base] : ['.ts', '.tsx', '.mts', '/index.ts'].map((extension) => base + extension)

const resolveSource = (from: string, specifier: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const base = path.resolve(path.dirname(from), specifier.replace(/\.(m?js|jsx)$/, ''))
    const isOtherFile = !TYPESCRIPT_SOURCE.test(base) && (yield* fileSystem.exists(base)) && (yield* fileSystem.stat(base)).type === 'File'
    return isOtherFile ? Option.none() : yield* Effect.findFirst(candidatesFor(base), (candidate) => fileSystem.exists(candidate))
  })

const reachableSources = (root: string, entries: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const seen = new Map<string, string>()
    const walk = (file: string): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
      seen.has(file)
        ? Effect.void
        : Effect.gen(function* () {
          const text = yield* fileSystem.readFileString(file)
          seen.set(file, text)
          const next = yield* Effect.forEach(specifiersOf(file, text), (specifier) => resolveSource(file, specifier))
          yield* Effect.forEach(Arr.getSomes(next), walk, { discard: true })
        })
    yield* Effect.forEach(entries.map((entry) => path.resolve(root, entry)), walk, { discard: true })
    return new Map(Arr.sort([...seen], Order.mapInput(Order.String, ([file]: readonly [string, string]) => file)))
  })

const discover = (subject: Subject) =>
  Effect.gen(function* () {
    const manifest = yield* readManifest(subject.root)
    const entries = entrySources(manifest)
    const sources = yield* reachableSources(subject.root, entries)
    return { manifest, entries, sources }
  })

const declarationPath = (root: string, file: string, path: Path.Path): string =>
  path.relative(root, file).replace(/\.([mc]?)tsx?$/, (_, flavour: string) => `.d.${flavour}ts`)

const emitOxc = (root: string, sources: ReadonlyMap<string, string>, path: Path.Path): Emit => {
  const results = [...sources].map(([file, text]) => [declarationPath(root, file, path), isolatedDeclarationSync(file, text, { stripInternal: false })] as const)
  return { diagnostics: results.reduce((sum, [, result]) => sum + result.errors.length, 0), outputs: new Map(results.map(([file, result]) => [file, result.code])) }
}

const emitTranspileDeclaration = (root: string, sources: ReadonlyMap<string, string>, path: Path.Path): Emit => {
  const results = [...sources].map(([file, text]) =>
    [declarationPath(root, file, path), ts59.transpileDeclaration(text, { fileName: file, compilerOptions: { isolatedDeclarations: true, declaration: true } })] as const
  )
  return { diagnostics: results.reduce((sum, [, result]) => sum + (result.diagnostics?.length ?? 0), 0), outputs: new Map(results.map(([file, result]) => [file, result.outputText])) }
}

const tsconfigOf = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const build = path.join(root, 'tsconfig.build.json')
    return (yield* fileSystem.exists(build)) ? build : path.join(root, 'tsconfig.json')
  })

interface CompileRun {
  readonly exitCode: number
  readonly diagnostics: ReadonlyArray<string>
  readonly outDir: string
}

const compile = (tsc: string, subject: Subject, extra: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const outDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'front-end-profile-' })
    const tsconfig = yield* tsconfigOf(subject.root)
    const derived = yield* FrontEnd.writeDerivedTsconfig({ tsconfigPath: tsconfig, packageRoot: subject.root, workspaceRoot: subject.workspaceRoot, outDir })
    const args = [tsc, '-p', derived, '--pretty', 'false', ...extra]
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, args, { cwd: subject.root }))
    const [stdout] = yield* Effect.all([Stream.decodeText(handle.stdout).pipe(Stream.mkString), Stream.decodeText(handle.stderr).pipe(Stream.mkString)], { concurrency: 2 })
    const exitCode = yield* handle.exitCode
    const run: CompileRun = { exitCode, diagnostics: stdout.split('\n').filter((line) => / error TS\d+/.test(line)), outDir }
    return run
  })

const readOutputs = (run: CompileRun, subject: Subject, sources: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const pairs = yield* Effect.forEach([...sources.keys()], (file) => {
      const relative = declarationPath(subject.root, file, path)
      const emitted = path.join(run.outDir, path.relative(subject.workspaceRoot, subject.root), relative)
      return Effect.map(Effect.option(fileSystem.readFileString(emitted)), (text) => [relative, text] as const)
    })
    return new Map(pairs.flatMap(([file, text]) => (Option.isSome(text) ? [[file, text.value] as const] : [])))
  })

const parseOxc = (outputs: ReadonlyMap<string, string>): number =>
  [...outputs].reduce((count, [file, text]) => count + parseSync(file, text).program.body.length, 0)

const parseTypeScript = (outputs: ReadonlyMap<string, string>): number =>
  [...outputs].reduce((count, [file, text]) => count + ts59.createSourceFile(file, text, ts59.ScriptTarget.Latest, true).statements.length, 0)

const isolatedErrorsIn = (run: CompileRun, subject: Subject, sources: ReadonlyMap<string, string>, path: Path.Path): number => {
  const files = [...sources.keys()].map((file) => path.relative(subject.root, file))
  return run.diagnostics.filter((line) => / error TS9\d{3}:/.test(line) && files.some((file) => line.startsWith(file))).length
}

type Divergence = { readonly compared: number; readonly differing: number; readonly missing: number; readonly typescript59ExitCode: number }

const divergenceOf = (left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>, typescript59ExitCode: number): Divergence => {
  const shared = [...left].filter(([file]) => right.has(file))
  return {
    compared: shared.length,
    differing: shared.filter(([file, text]) => right.get(file) !== text).length,
    missing: left.size - shared.length,
    typescript59ExitCode,
  }
}

const PHASES = [
  'discover',
  'emit:oxc-transform',
  'emit:transpileDeclaration',
  'emit:tsc7',
  'emit:tsc5.9.3',
  'parse:oxc-parser',
  'parse:createSourceFile',
  'build:model',
  'resolve:messages',
] as const
type Phase = (typeof PHASES)[number]

interface Cleanliness {
  readonly diagnostics: number
  readonly clean: boolean
}

interface PackageProfile {
  readonly name: string
  readonly version: string
  readonly origin: Subject['origin']
  readonly entryPoints: number
  readonly sourceFiles: number
  readonly sourceBytes: number
  readonly declarationFiles: number
  readonly declarationStatements: number
  readonly clean: Readonly<Record<'oxc-transform' | 'transpileDeclaration' | 'tsc --isolatedDeclarations', Cleanliness>>
  readonly fallback: { readonly exitCode: number; readonly diagnostics: number }
  readonly divergence: Divergence
  readonly frontEnd: FrontEndOutcome
  readonly phases: Readonly<Record<Phase, Timing>>
}

interface FrontEndOutcome {
  readonly route: 'FastPath' | 'Fallback' | 'refused'
  readonly outcome: string
  readonly items: number
  readonly locals: number
  readonly messages: number
}

type Emitters = FrontEnd.IsolatedEmitterId | FrontEnd.CompilerEmitterId

const routedDeclarations = (source: FrontEnd.PackageSource) =>
  Effect.gen(function* () {
    const isolated = yield* FrontEnd.IsolatedEmitter
    const compiler = yield* FrontEnd.CompilerEmitter
    return yield* isolated.emit(source).pipe(
      Effect.map((declarations) => ({ route: 'FastPath' as const, declarations })),
      Effect.catchTag('NotIsolated', () => Effect.map(compiler.emit(source), (declarations) => ({ route: 'Fallback' as const, declarations }))),
    )
  })

const itemCount = (model: ApiModel.ApiModel): number => model.entryPoints.reduce((sum, entry) => sum + entry.items.length, 0)
const localCount = (model: ApiModel.ApiModel): number => model.entryPoints.reduce((sum, entry) => sum + entry.locals.length, 0)

const refusalOf = (error: { readonly _tag: string; readonly message: string }): string => `${error._tag}: ${error.message.split('\n')[0] ?? ''}`

const notRun: Timing = { coldMs: 0, warmMedianMs: 0 }

const frontEndProfile = (subject: Subject) =>
  Effect.gen(function* () {
    const routed = yield* Effect.result(Effect.flatMap(FrontEnd.readPackage({ packageRoot: subject.root }), routedDeclarations))
    if (Result.isFailure(routed)) {
      const outcome: FrontEndOutcome = { route: 'refused', outcome: refusalOf(routed.failure), items: 0, locals: 0, messages: 0 }
      return { outcome, build: notRun, resolve: notRun }
    }
    const { route, declarations } = routed.success
    const built = yield* measure(Effect.result(FrontEnd.buildModel(declarations)))
    const resolved = yield* measure(Effect.result(FrontEnd.resolveMessages(declarations)))
    const model = Result.getOrUndefined(built.result)
    const outcome: FrontEndOutcome = {
      route,
      outcome: Result.isSuccess(built.result) ? 'model' : refusalOf(built.result.failure),
      items: model === undefined ? 0 : itemCount(model),
      locals: model === undefined ? 0 : localCount(model),
      messages: Result.isSuccess(resolved.result) ? resolved.result.success.length : 0,
    }
    return { outcome, build: built.timing, resolve: resolved.timing }
  })

const tscBin = (packageName: string, path: Path.Path): string => path.join(path.dirname(require.resolve(`${packageName}/package.json`)), 'bin', 'tsc')

const profilePackage = (subject: Subject): Effect.Effect<PackageProfile, ProfileError, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Emitters> =>
  Effect.scoped(Effect.gen(function* () {
    const path = yield* Path.Path
    const discovery = yield* measure(discover(subject))
    const { manifest, entries, sources } = discovery.result
    const oxc = yield* measure(Effect.sync(() => emitOxc(subject.root, sources, path)))
    const transpile = yield* measure(Effect.sync(() => emitTranspileDeclaration(subject.root, sources, path)))
    const tsc7 = yield* measure(compile(tscBin('typescript', path), subject, []))
    const isolatedReferee = yield* compile(tscBin('typescript', path), subject, ['--isolatedDeclarations'])
    const tsc59 = yield* measure(compile(tscBin('typescript-5.9', path), subject, []), 0)
    const outputs7 = yield* readOutputs(tsc7.result, subject, sources)
    const outputs59 = yield* readOutputs(tsc59.result, subject, sources)
    const parsedOxc = yield* measure(Effect.sync(() => parseOxc(outputs7)))
    const parsedTypeScript = yield* measure(Effect.sync(() => parseTypeScript(outputs7)))
    const refereeErrors = isolatedErrorsIn(isolatedReferee, subject, sources, path)
    const frontEnd = yield* frontEndProfile(subject)
    return {
      name: manifest.name,
      version: manifest.version,
      origin: subject.origin,
      entryPoints: entries.length,
      sourceFiles: sources.size,
      sourceBytes: [...sources.values()].reduce((sum, text) => sum + text.length, 0),
      declarationFiles: outputs7.size,
      declarationStatements: parsedOxc.result,
      clean: {
        'oxc-transform': { diagnostics: oxc.result.diagnostics, clean: oxc.result.diagnostics === 0 },
        transpileDeclaration: { diagnostics: transpile.result.diagnostics, clean: transpile.result.diagnostics === 0 },
        'tsc --isolatedDeclarations': { diagnostics: refereeErrors, clean: refereeErrors === 0 },
      },
      fallback: { exitCode: tsc7.result.exitCode, diagnostics: tsc7.result.diagnostics.length },
      divergence: divergenceOf(outputs7, outputs59, tsc59.result.exitCode),
      frontEnd: frontEnd.outcome,
      phases: {
        discover: discovery.timing,
        'emit:oxc-transform': oxc.timing,
        'emit:transpileDeclaration': transpile.timing,
        'emit:tsc7': tsc7.timing,
        'emit:tsc5.9.3': tsc59.timing,
        'parse:oxc-parser': parsedOxc.timing,
        'parse:createSourceFile': parsedTypeScript.timing,
        'build:model': frontEnd.build,
        'resolve:messages': frontEnd.resolve,
      },
    }
  }))

const gitLines = (root: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make('git', args, { cwd: root }))
    const [stdout, stderr] = yield* Effect.all(
      [Stream.decodeText(handle.stdout).pipe(Stream.mkString), Stream.decodeText(handle.stderr).pipe(Stream.mkString)],
      { concurrency: 2 },
    )
    const exitCode = yield* handle.exitCode
    return yield* Option.match(Option.liftPredicate(exitCode, (code) => code === 0), {
      onNone: () => Effect.fail(new GitError({ args, exitCode, stderr: stderr.trim() })),
      onSome: () => Effect.succeed(stdout.split('\n').filter((line) => line !== '')),
    })
  })

const corpusSubjects = (corpusRoot: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const manifests = (yield* gitLines(corpusRoot, ['ls-files', 'packages/**/package.json']))
      .filter((file) => !file.includes('/fixtures/') && !file.includes('/__fixtures__/'))
      .map((file) => path.join(corpusRoot, path.dirname(file)))
    const eligible = yield* Effect.filter(manifests, (root) =>
      Effect.map(readManifest(root), (manifest) => manifest.private !== true && entrySources(manifest).length > 0)
    )
    return Arr.sort(eligible, Order.String).map((root): Subject => ({ origin: 'systemfsoftware', root, workspaceRoot: corpusRoot }))
  })

const gitHead = (root: string) => Effect.map(gitLines(root, ['rev-parse', 'HEAD']), (lines) => lines[0] ?? '')

const versionOf = (specifier: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const manifest = yield* readManifest(path.dirname(require.resolve(`${specifier}/package.json`)))
    return manifest.version
  })

interface Report {
  readonly corpus: { readonly repository: string; readonly commit: string }
  readonly ownPackage: { readonly repository: string; readonly commit: string }
  readonly host: { readonly cpu: string; readonly cores: number; readonly platform: string; readonly node: string }
  readonly tools: Readonly<Record<string, string>>
  readonly runs: { readonly cold: number; readonly warm: number; readonly 'emit:tsc5.9.3': string }
  readonly totals: Readonly<Record<string, number>>
  readonly packages: ReadonlyArray<PackageProfile>
}

const total = (packages: ReadonlyArray<PackageProfile>, phase: Phase, key: keyof Timing): number =>
  round(packages.reduce((sum, item) => sum + item.phases[phase][key], 0))

const markdownOf = (report: Report): string => {
  const header = `| Package | Origin | Sources | oxc clean | tD clean | tsc ID clean | ${PHASES.join(' | ')} | TS7≠5.9.3 | no 5.9.3 emit | route | model |`
  const rule = `|${'---|'.repeat(PHASES.length + 10)}`
  const rows = report.packages.map((item) =>
    `| ${item.name} | ${item.origin} | ${item.sourceFiles} | ${item.clean['oxc-transform'].diagnostics} | ${item.clean.transpileDeclaration.diagnostics} | ${item.clean['tsc --isolatedDeclarations'].diagnostics} | ${PHASES.map((phase) => item.phases[phase].warmMedianMs).join(' | ')} | ${item.divergence.differing}/${item.divergence.compared} | ${item.divergence.missing} | ${item.frontEnd.route} | ${item.frontEnd.outcome} |`
  )
  const totals = `| **total** | | ${report.packages.reduce((sum, item) => sum + item.sourceFiles, 0)} | | | | ${PHASES.map((phase) => report.totals[phase]).join(' | ')} | ${report.packages.reduce((sum, item) => sum + item.divergence.differing, 0)}/${report.packages.reduce((sum, item) => sum + item.divergence.compared, 0)} | ${report.packages.reduce((sum, item) => sum + item.divergence.missing, 0)} | | |`
  return [
    '# Front-end phase profile',
    '',
    'Generated by `apps/api-extractor-profile/profile.ts`; the JSON beside this file is the record. Times are warm medians in milliseconds;',
    'the clean columns count isolated-declaration diagnostics over the files the entry sources reach.',
    '',
    '```json',
    JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'packages')), null, 2),
    '```',
    '',
    header,
    rule,
    ...rows,
    totals,
    '',
  ].join('\n')
}

const program = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const [corpusArgument, outputArgument] = process.argv.slice(2)
  if (corpusArgument === undefined || outputArgument === undefined) {
    return yield* new UsageError({ usage: 'profile.ts <corpus-root> <output-base>' })
  }
  const corpusRoot = path.resolve(corpusArgument)
  const repositoryRoot = path.resolve(path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))), '..', '..')
  const own: Subject = { origin: 'api-extractor-effect', root: path.join(repositoryRoot, 'packages', 'api-extractor'), workspaceRoot: repositoryRoot }
  const subjects = [own, ...(yield* corpusSubjects(corpusRoot))]
  const packages = yield* Effect.forEach(subjects, (subject) => Effect.tap(profilePackage(subject), (item) => Effect.logInfo(`${item.name}: ${item.sourceFiles} sources`)))
  const tools = yield* Effect.forEach(['oxc-transform', 'oxc-parser', 'typescript', 'typescript-5.9'], (name) => Effect.map(versionOf(name), (version) => [name, version] as const))
  const report: Report = {
    corpus: { repository: 'https://github.com/systemfsoftware/systemfsoftware', commit: yield* gitHead(corpusRoot) },
    ownPackage: { repository: 'https://github.com/systemfsoftware/api-extractor-effect', commit: yield* gitHead(repositoryRoot) },
    host: { cpu: os.cpus()[0]?.model ?? 'not reported', cores: os.cpus().length, platform: `${process.platform}-${process.arch}`, node: process.version },
    tools: Object.fromEntries(tools),
    runs: { cold: 1, warm: WARM_RUNS, 'emit:tsc5.9.3': 'cold only' },
    totals: Object.fromEntries(PHASES.map((phase) => [phase, total(packages, phase, 'warmMedianMs')])),
    packages,
  }
  yield* fileSystem.writeFileString(`${outputArgument}.json`, `${JSON.stringify(report, null, 2)}\n`)
  yield* fileSystem.writeFileString(`${outputArgument}.md`, markdownOf(report))
})

const emitters = Layer.mergeAll(FrontEnd.isolatedEmitterLayer, FrontEnd.compilerEmitterLayer).pipe(Layer.provideMerge(NodeServices.layer))

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(emitters)))
