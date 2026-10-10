import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { encodeApiModel } from '../src/model/api-model.ts'
import { apiModel } from './__fixtures__/arbitraries.ts'

const probe = fileURLToPath(new URL('./__fixtures__/serialise-probe.ts', import.meta.url))
const elsewhere = mkdtempSync(join(tmpdir(), 'api-extractor-locale-'))

/** Node fixes its default locale at start-up, so each environment is its own process. */
const environments = [
  { LC_ALL: 'C', TZ: 'UTC', cwd: process.cwd(), expectLocale: undefined },
  { LC_ALL: 'tr_TR.UTF-8', TZ: 'Europe/Istanbul', cwd: process.cwd(), expectLocale: 'tr' },
  { LC_ALL: 'de_DE.UTF-8', TZ: 'America/Los_Angeles', cwd: elsewhere, expectLocale: 'de' },
] as const

const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(LC_|LANG|LANGUAGE$|TZ$)/.test(key)),
)

interface ProbeResult {
  readonly locale: string
  readonly timeZone: string
  readonly cwd: string
  readonly outputs: ReadonlyArray<string>
}

const run = (environment: (typeof environments)[number], input: string): ProbeResult => {
  const child = spawnSync(process.execPath, [probe], {
    input,
    cwd: environment.cwd,
    env: { ...inherited, LC_ALL: environment.LC_ALL, TZ: environment.TZ },
    encoding: 'utf8',
  })
  if (child.status !== 0) throw new Error(`probe failed under ${environment.LC_ALL}: ${child.stderr}`)
  return JSON.parse(child.stdout) as ProbeResult
}

describe('output bytes across locales, time zones and working directories', () => {
  it('AE5: every model and verdict serialises to the same bytes in every environment', () => {
    fc.assert(
      fc.property(fc.array(apiModel, { minLength: 2, maxLength: 4 }), (models) => {
        const input = JSON.stringify(models.map(encodeApiModel))
        const results = environments.map((environment) => run(environment, input))
        environments.forEach((environment, index) => {
          const result = results[index]!
          if (environment.expectLocale !== undefined) expect(result.locale.startsWith(environment.expectLocale)).toBe(true)
          expect(result.timeZone).toBe(environment.TZ)
          expect(result.cwd).toBe(environment.cwd)
        })
        const [first, ...rest] = results.map((result) => result.outputs)
        for (const outputs of rest) expect(outputs).toEqual(first)
      }),
      { numRuns: 4 },
    )
  }, 60_000)
})
