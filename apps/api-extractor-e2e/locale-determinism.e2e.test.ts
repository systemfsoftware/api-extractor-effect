import { ApiModel } from '@systemfsoftware/api-extractor'
import { describe } from '@systemfsoftware/vitest'
import { Schema } from 'effect'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outputsOf } from './outputs.ts'

const probe = fileURLToPath(new URL('./probe.ts', import.meta.url))
const elsewhere = mkdtempSync(join(tmpdir(), 'api-extractor-locale-'))

const environments = [
  { LC_ALL: 'C', TZ: 'UTC', cwd: process.cwd(), expectLocale: undefined },
  { LC_ALL: 'tr_TR.UTF-8', TZ: 'Europe/Istanbul', cwd: process.cwd(), expectLocale: 'tr' },
  { LC_ALL: 'de_DE.UTF-8', TZ: 'America/Los_Angeles', cwd: elsewhere, expectLocale: 'de' },
] as const
type Environment = (typeof environments)[number]

const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(LC_|LANG|LANGUAGE$|TZ$)/.test(key)))

interface ProbeResult {
  readonly locale: string
  readonly timeZone: string
  readonly cwd: string
  readonly outputs: ReadonlyArray<string>
}

const run = (environment: Environment, input: string): ProbeResult => {
  const child = spawnSync(process.execPath, [probe], {
    input,
    cwd: environment.cwd,
    env: { ...inherited, LC_ALL: environment.LC_ALL, TZ: environment.TZ },
    encoding: 'utf8',
  })
  if (child.status !== 0) throw new Error(`probe failed under ${environment.LC_ALL}: ${child.stderr}`)
  return JSON.parse(child.stdout) as ProbeResult
}

const runEverywhere = (models: ReadonlyArray<ApiModel.ApiModel>): ReadonlyArray<ProbeResult> => {
  const input = JSON.stringify(models.map(ApiModel.encode))
  return environments.map((environment) => run(environment, input))
}

const resolved = (environment: Environment, result: ProbeResult): boolean =>
  (environment.expectLocale === undefined || result.locale.startsWith(environment.expectLocale)) &&
  result.timeZone === environment.TZ &&
  result.cwd === environment.cwd

describe('output bytes across locales, time zones and working directories', (it) => {
  it.prop(
    'AE5: every model and verdict serialises, in every environment, to the bytes this process writes',
    { of: [Schema.Array(ApiModel.ApiModel).check(Schema.isBetweenLength(2, 4))], subject: runEverywhere, runs: 4 },
    (runEverywhere, [models]) => {
      const expected = JSON.stringify(outputsOf(models))
      return runEverywhere(models).every((result, index) => resolved(environments[index]!, result) && JSON.stringify(result.outputs) === expected)
    },
  )
})
