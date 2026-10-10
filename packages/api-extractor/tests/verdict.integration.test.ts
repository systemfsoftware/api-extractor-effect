import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { ApiModel, Verdict } from '../src/mod.ts'
import { effect, functionItem, ref, rooted, signature, union, withExport } from './__fixtures__/surfaces.ts'

const empty: ApiModel.ApiModel = rooted({
  schemaVersion: ApiModel.SCHEMA_VERSION,
  producer: { engine: 'fixture@0.0.0', declarations: 'hand-written' },
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: [],
})
const before = withExport(empty, functionItem(signature([], effect(ref('User'), ref('NotFound')))))
const after = withExport(empty, functionItem(signature([], effect(ref('User'), union([ref('NotFound'), ref('Timeout')])))))
const [first] = Verdict.defaultCorpus.rules
const ambiguous = { ...Verdict.defaultCorpus, rules: [...Verdict.defaultCorpus.rules, { ...first!, rule_id: 'copy' }] }

describe('verdict cell', () => {
  it('answers the verdict document as canonical JSON', async () => {
    const document = await Effect.runPromise(Verdict.cell.run({ before, after }))
    expect(document.endsWith('}\n')).toBe(true)
    expect(JSON.parse(document)).toMatchObject({
      _tag: 'Verdict',
      bump: 'major',
      findings: [{ reason_code: 'E_WIDENED', locations: ['.:target/signature[0]/returns/E'] }],
    })
  })

  it('refuses a surface that does not decode with SurfaceRejected', async () => {
    const wrongVersion = { ...before, schemaVersion: 2 } as unknown as ApiModel.ApiModel
    const refusal = await Effect.runPromise(Effect.flip(Verdict.cell.run({ before: wrongVersion, after })))
    expect(refusal).toBeInstanceOf(Verdict.SurfaceRejected)
  })

  it('refuses an ambiguous corpus with RuleCorpusRejected naming the shared match', async () => {
    const refusal = await Effect.runPromise(Effect.flip(Verdict.cell.run({ before, after, corpus: ambiguous })))
    expect(refusal).toBeInstanceOf(Verdict.RuleCorpusRejected)
    expect(refusal).toMatchObject({ ambiguities: [expect.stringMatching(/^two rules match /)] })
  })
})
