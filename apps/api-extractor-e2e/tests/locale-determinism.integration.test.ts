import { ApiModel } from '@systemfsoftware/api-extractor'
import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Arbitrary, Effect, FileSystem, Path, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Models, ProbeReport, type ProbeResult } from '../models.schema.ts'
import { outputsOf } from '../outputs.ts'

interface Environment {
  readonly LC_ALL: string
  readonly TZ: string
  readonly cwd: string
  readonly expectLocale: string | undefined
}

interface ProbeRun {
  readonly environment: Environment
  readonly expected: ReadonlyArray<string>
  readonly result: ProbeResult
}

const SAMPLE_COUNT = 4
const ENVIRONMENT_COUNT = 3

const samples = Arbitrary.sampleEffect(Arbitrary.schema(Models), { count: SAMPLE_COUNT, seed: 20261010 })

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(LC_|LANG|LANGUAGE$|TZ$)/.test(key)),
)

const environmentsFor = (elsewhere: string): ReadonlyArray<Environment> => [
  { LC_ALL: 'C', TZ: 'UTC', cwd: process.cwd(), expectLocale: undefined },
  { LC_ALL: 'tr_TR.UTF-8', TZ: 'Europe/Istanbul', cwd: process.cwd(), expectLocale: 'tr' },
  { LC_ALL: 'de_DE.UTF-8', TZ: 'America/Los_Angeles', cwd: elsewhere, expectLocale: 'de' },
]

const runProbe = (environment: Environment, input: string, probePath: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const command = ChildProcess.make(process.execPath, ['--conditions=@systemfsoftware/source', probePath], {
      cwd: environment.cwd,
      env: { ...inheritedEnv, LC_ALL: environment.LC_ALL, TZ: environment.TZ },
      stdin: Stream.encodeText(Stream.make(input)),
    })
    const handle = yield* spawner.spawn(command)
    const stdout = yield* Stream.decodeText(handle.stdout).pipe(Stream.mkString)
    const exitCode = yield* handle.exitCode
    if (exitCode !== 0) {
      const stderr = yield* Stream.decodeText(handle.stderr).pipe(Stream.mkString)
      return yield* Effect.die(`probe exited with ${exitCode} under ${environment.LC_ALL}: ${stderr}`)
    }
    return yield* Schema.decodeEffect(ProbeReport)(stdout)
  })

const violations = ({ environment, expected, result }: ProbeRun): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const { expectLocale } = environment
  if (expectLocale !== undefined && !result.locale.startsWith(expectLocale)) {
    problems.push(`${environment.LC_ALL} resolved locale ${result.locale}, which lacks the ${expectLocale} prefix`)
  }
  if (result.timeZone !== environment.TZ) {
    problems.push(`${environment.LC_ALL} resolved time zone ${result.timeZone} instead of ${environment.TZ}`)
  }
  if (result.cwd !== environment.cwd) {
    problems.push(`${environment.LC_ALL} resolved directory ${result.cwd} instead of ${environment.cwd}`)
  }
  if (JSON.stringify(result.outputs) !== JSON.stringify(expected)) {
    problems.push(`${environment.LC_ALL} wrote different bytes than the host process`)
  }
  return problems
}

const Feature = makeFeature({ it })

Feature('Locale-independent API model bytes')
  .withLayer(NodeServices.layer)
  .live('every scenario spawns the probe as a real child process under a real locale, time zone and directory')
  .body(({ scenario }) => {
    scenario(
      'the probe reports its resolved environment and writes the host bytes under three environments',
      Gherkin.Do.pipe(
        Given('a fixed sample of API models')('sample', () => samples),
        When('the probe runs under a C locale, a Turkish locale and a German locale')('runs', (scope) =>
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const elsewhere = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'api-extractor-locale-' })
            const probePath = yield* path.fromFileUrl(new URL('../probe.ts', import.meta.url))
            const environments = environmentsFor(elsewhere)
            const runs = yield* Effect.forEach(scope.sample, (models) => {
              const input = JSON.stringify(models.map(ApiModel.encode))
              const expected = outputsOf(models)
              return Effect.forEach(environments, (environment) =>
                Effect.map(runProbe(environment, input, probePath), (result) => ({ environment, expected, result })),
              )
            })
            return runs.flat()
          }),
        ),
        Then('every environment matches the host bytes and its own locale, time zone and directory')(
          (scope, expect) =>
            Effect.succeed(
              expect({
                samples: scope.sample.length,
                runs: scope.runs.length,
                violations: scope.runs.flatMap(violations),
              }).toEqual({
                samples: SAMPLE_COUNT,
                runs: SAMPLE_COUNT * ENVIRONMENT_COUNT,
                violations: [],
              }),
            ),
        ),
      ),
    )
  })
