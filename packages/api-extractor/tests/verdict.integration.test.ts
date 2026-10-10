import { describe } from '@systemfsoftware/vitest'
import { Effect } from 'effect'
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

describe('verdict cell', (it) => {
  it('answers the verdict document as canonical JSON', function* ({ expect }) {
    const document = yield* Verdict.cell.run({ before, after })
    yield* expect({ terminated: document.endsWith('}\n'), body: JSON.parse(document) }).toMatchObject({
      terminated: true,
      body: { _tag: 'Verdict', bump: 'major', findings: [{ reason_code: 'E_WIDENED', locations: ['.:target/signature[0]/returns/E'] }] },
    })
  })

  it('refuses a surface that does not decode with SurfaceRejected', function* ({ expect }) {
    const wrongVersion = { ...before, schemaVersion: ApiModel.SCHEMA_VERSION + 1 } as unknown as ApiModel.ApiModel
    const refusal = yield* Effect.flip(Verdict.cell.run({ before: wrongVersion, after }))
    yield* expect(refusal._tag).toBe('SurfaceRejected')
  })

  it('refuses an ambiguous corpus with RuleCorpusRejected naming the shared match', function* ({ expect }) {
    const refusal = yield* Effect.flip(Verdict.cell.run({ before, after, corpus: ambiguous }))
    yield* expect(refusal).toMatchObject({ _tag: 'RuleCorpusRejected', ambiguities: [`two rules match ${first!.match.kind}|*|*|*`] })
  })
})
