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
const entry = { path: '.', items: [], locals: [] }
const enumOf = (...names: ReadonlyArray<string>): ApiModel.ApiItem => ({ kind: 'enum', name: 'Mode', const: false, members: names.map((name) => ({ name })) })
const repeatedKeys = [
  { label: 'an entry-point path', surface: { ...empty, entryPoints: [entry, entry] } },
  { label: 'an enum member name', surface: withExport(empty, enumOf('On', 'On')) },
]

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

  it.each(repeatedKeys)('refuses a surface repeating $label with SurfaceRejected', function* ({ surface }, { expect }) {
    const repeated = yield* Effect.flip(Verdict.cell.run({ before: surface, after }))
    const distinct = yield* Verdict.cell.run({ before: withExport(empty, enumOf('On', 'Off')), after })
    yield* expect({ repeated: repeated._tag, distinct: JSON.parse(distinct)._tag }).toEqual({ repeated: 'SurfaceRejected', distinct: 'Verdict' })
  })

  it('refuses an ambiguous corpus with RuleCorpusRejected naming the shared match', function* ({ expect }) {
    const refusal = yield* Effect.flip(Verdict.cell.run({ before, after, corpus: ambiguous }))
    yield* expect(refusal).toMatchObject({ _tag: 'RuleCorpusRejected', ambiguities: [`two rules match ${first!.match.kind}|*|*|*`] })
  })
})
