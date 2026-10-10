import { describe } from '@systemfsoftware/vitest'
import { Array as Arr, Option, Order, Result, Schema } from 'effect'
import { canonicalJson, type Json } from '../canonical-json.schema.ts'
import { judgeSurfaces } from '../judge-surfaces.workflow.ts'
import { ApiItem, ApiModel, type TypeAliasItem } from '../model/api-model.schema.ts'
import { type Signature, TypeExpr } from '../model/type-expr.schema.ts'
import { type Bump, maxBump, type Rule, type RuleCorpus, UNCLASSIFIED } from '../rules/corpus.schema.ts'
import { defaultCorpus } from '../rules/default-corpus.ts'
import { bumpOf } from '../rules/finding.schema.ts'
import { type AmbiguousRuleCorpus, CompareSurfaces, type Verdict } from '../verdict.schema.ts'
import {
  alias,
  effect,
  fn,
  functionItem,
  never,
  parameter,
  ref,
  rooted,
  rootedWith,
  signature,
  TARGET,
  union,
  voidType,
  withExport,
} from '../../tests/__fixtures__/surfaces.ts'
import { tags } from '../../tests/__fixtures__/verdict-draws.schema.ts'

type Judged = Result.Result<Verdict, AmbiguousRuleCorpus>
const judge = (before: ApiModel, after: ApiModel, corpus: RuleCorpus = defaultCorpus): Judged =>
  judgeSurfaces(new CompareSurfaces({ engine: 'fixture@0.0.0', before, after, corpus }))

const located = (result: Judged) =>
  Result.isSuccess(result)
    ? { bump: result.success.bump, findings: result.success.findings.map((finding) => [finding.reason_code, finding.locations]) }
    : { refused: result.failure.ambiguities }
const reasons = (result: Judged) =>
  Result.isSuccess(result)
    ? { bump: result.success.bump, reasons: result.success.findings.map((finding) => finding.reason_code) }
    : { refused: result.failure.ambiguities }
const same = (left: Json, right: Json): boolean => canonicalJson(left) === canonicalJson(right)
const verdict = (bump: Bump, ...findings: ReadonlyArray<readonly [string, ReadonlyArray<string>]>) => ({ bump, findings })
const refused = (...ambiguities: ReadonlyArray<string>) => ({ refused: ambiguities })

const grown = (first: string, rest: ReadonlyArray<string>) => {
  const labels = [first, ...rest]
  const before = labels.map((label) => ref(`Tag${label}`))
  return { smaller: union(before), larger: union([...before, ref(`Tag${labels.join('')}+`)]) }
}

const target = (surrounding: ApiModel, item: ApiItem, locals: ReadonlyArray<TypeAliasItem> = []) =>
  rootedWith(surrounding, [item], locals)
const returning = (type: TypeExpr) => functionItem(signature([], type))
const taking = (type: TypeExpr) => functionItem(signature([parameter('self', type)], voidType))
const at = (path: string) => `.:${TARGET}/${path}`

describe('verdict on Effect channels', (it) => {
  it.prop(
    '∀m_EffectErrorReturn_⊆Widened',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, returning(effect(value, smaller))), target(surrounding, returning(effect(value, larger))))
      return same(located(result), verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    '∀e_Finding_≡MergedLocationsOnce',
    { of: [ApiModel, TypeExpr, ...tags, Schema.String, Schema.Array(Schema.String)], subject: judge },
    (judge, [surrounding, value, first, rest, one, others]) => {
      const { smaller, larger } = grown(first, rest)
      const names = [one, `${one}+`, ...others].map((label, index) => `fn${index}:${label}`)
      const exportsOf = (failure: TypeExpr) => {
        const signatures = [signature([], effect(value, failure))]
        return rootedWith(surrounding, names.map((name): ApiItem => ({ kind: 'function', name, signatures })))
      }
      return same(
        located(judge(exportsOf(smaller), exportsOf(larger))),
        verdict('major', ['E_WIDENED', names.map((name) => `.:${name}/signature[0]/returns/E`).sort(Order.String)]),
      )
    },
  )

  it.prop(
    '∀m_EffectErrorReturn_≡TagRemoved',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, returning(effect(value, larger))), target(surrounding, returning(effect(value, smaller))))
      return same(located(result), verdict('major', ['E_TAG_REMOVED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    '∀m_EffectErrorInput_⊆Widened',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, taking(effect(value, smaller))), target(surrounding, taking(effect(value, larger))))
      return same(located(result), verdict('minor', ['E_WIDENED_IN_INPUT', [at('signature[0]/parameter[0]/E')]]))
    },
  )

  it.prop(
    '∀m_CallbackError_⊆Widened',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const surface = (slot: TypeExpr) => target(surrounding, taking(fn(signature([parameter('event', effect(value, slot))], voidType))))
      return same(located(judge(surface(smaller), surface(larger))), verdict('major', ['E_WIDENED', [at('signature[0]/parameter[0]/parameter[0]/E')]]))
    },
  )

  it.prop(
    '∀m_LocalAliasUse_⊆Widened',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const item = returning(effect(value, ref('Err')))
      const result = judge(target(surrounding, item, [alias('Err', smaller)]), target(surrounding, item, [alias('Err', larger)]))
      return same(located(result), verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    '∀m_LayerOutput_≡Contravariant',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, failure, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const layer = (services: TypeExpr) => target(surrounding, returning(ref('Layer', services, failure, never)))
      return same(
        [reasons(judge(layer(larger), layer(smaller))), reasons(judge(layer(smaller), layer(larger)))],
        [{ bump: 'major', reasons: ['LAYER_SERVICE_REMOVED'] }, { bump: 'minor', reasons: ['LAYER_SERVICE_ADDED'] }],
      )
    },
  )
})

describe('verdict on dual APIs', (it) => {
  const dual = (value: TypeExpr, failure: TypeExpr) => {
    const mapper = parameter('f', fn(signature([parameter('a', ref('A'))], value)))
    const self = parameter('self', effect(ref('A'), failure))
    return {
      dataLast: signature([mapper], fn(signature([self], effect(value, failure)))),
      dataFirst: signature([self, mapper], effect(value, failure)),
    }
  }
  const constant = (...forms: ReadonlyArray<Signature>): ApiItem => ({
    kind: 'variable',
    name: TARGET,
    constant: true,
    type: { kind: 'object', members: forms.map((sig) => ({ kind: 'call', signature: sig })) },
  })

  it.prop(
    '∀m_DualForm_≡FormRemoved',
    { of: [ApiModel, TypeExpr, TypeExpr, Schema.Boolean], subject: judge },
    (judge, [surrounding, value, failure, dropDataLast]) => {
      const { dataLast, dataFirst } = dual(value, failure)
      const result = judge(target(surrounding, constant(dataLast, dataFirst)), target(surrounding, constant(dropDataLast ? dataFirst : dataLast)))
      return same(located(result), verdict('major', ['DUAL_FORM_REMOVED', [at(`call/signature[${dropDataLast ? 0 : 1}]`)]]))
    },
  )

  it.prop(
    '∀m_DualForm_≡FormAdded',
    { of: [ApiModel, TypeExpr, TypeExpr], subject: judge },
    (judge, [surrounding, value, failure]) => {
      const { dataLast, dataFirst } = dual(value, failure)
      const result = judge(target(surrounding, constant(dataFirst)), target(surrounding, constant(dataLast, dataFirst)))
      return same(reasons(result), { bump: 'minor', reasons: ['DUAL_FORM_ADDED'] })
    },
  )
})

describe('verdict on exports and parameters', (it) => {
  it.prop(
    '∀x_Export_≡RemovedAndAdded',
    { of: [ApiModel, ApiItem], subject: judge },
    (judge, [surrounding, item]) => {
      const empty = rootedWith(surrounding, [])
      const withTarget = target(surrounding, { ...item, name: TARGET })
      return same(
        [reasons(judge(withTarget, empty)), reasons(judge(empty, withTarget))],
        [{ bump: 'major', reasons: ['EXPORT_REMOVED'] }, { bump: 'minor', reasons: ['EXPORT_ADDED'] }],
      )
    },
  )

  it.prop(
    '∀x_Parameter_≡AddedRequiredOrOptional',
    { of: [ApiModel, TypeExpr, Schema.Boolean], subject: judge },
    (judge, [surrounding, value, optional]) => {
      const result = judge(target(surrounding, returning(value)), target(surrounding, functionItem(signature([parameter('extra', value, optional)], value))))
      return same(reasons(result), optional ? { bump: 'minor', reasons: ['OPTIONAL_PARAMETER_ADDED'] } : { bump: 'major', reasons: ['REQUIRED_PARAMETER_ADDED'] })
    },
  )

  it.prop(
    '∀x_EntryPoint_≡RemovedAndAdded',
    { of: [ApiModel], subject: judge },
    (judge, [model]) => {
      const extra = { path: `${model.entryPoints.map((entry) => entry.path).join('')}/extra`, items: [], locals: [] }
      const withExtra = { ...model, entryPoints: [...model.entryPoints, extra] }
      return same(
        [reasons(judge(withExtra, model)), reasons(judge(model, withExtra))],
        [{ bump: 'major', reasons: ['ENTRY_POINT_REMOVED'] }, { bump: 'minor', reasons: ['ENTRY_POINT_ADDED'] }],
      )
    },
  )
})

describe('verdict on Effect types spelled with defaulted channels', (it) => {
  it.prop(
    '∀m_TwoArgumentEffect_≡ChannelMapping',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const out = (failure: TypeExpr) => target(surrounding, returning(ref('Effect', value, failure)))
      const input = (failure: TypeExpr) => target(surrounding, taking(ref('Effect', value, failure)))
      return same(
        [located(judge(out(smaller), out(larger))), located(judge(input(smaller), input(larger)))],
        [
          verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]]),
          verdict('minor', ['E_WIDENED_IN_INPUT', [at('signature[0]/parameter[0]/E')]]),
        ],
      )
    },
  )

  it.prop(
    '∀m_DefaultedChannel_≡NeverDefault',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { larger } = grown(first, rest)
      const surface = (type: TypeExpr) => target(surrounding, returning(type))
      return same(
        [located(judge(surface(ref('Effect', value)), surface(effect(value, never)))), located(judge(surface(ref('Effect', value)), surface(ref('Effect', value, larger))))],
        [verdict('none'), verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]])],
      )
    },
  )

  it.prop(
    '∀m_TwoArgumentLayer_≡ServiceRemoved',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, failure, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const layer = (services: TypeExpr) => target(surrounding, returning(ref('Layer', services, failure)))
      return same(reasons(judge(layer(larger), layer(smaller))), { bump: 'major', reasons: ['LAYER_SERVICE_REMOVED'] })
    },
  )
})

describe('verdict through local type aliases', (it) => {
  const generic = (name: string, parameterName: string, defaultType: TypeExpr, type: TypeExpr): TypeAliasItem => ({
    kind: 'typeAlias',
    name,
    typeParameters: [{ name: parameterName, default: defaultType }],
    type,
  })

  it.prop(
    '∀m_ParameterDefaultAlias_≡InPlace',
    { of: [ApiModel, ...tags, Schema.Boolean], subject: judge },
    (judge, [surrounding, first, rest, output]) => {
      const { smaller, larger } = grown(first, rest)
      const handler = generic('Handler', 'F', ref('Err'), output ? fn(signature([], ref('F'))) : fn(signature([parameter('f', ref('F'))], voidType)))
      const direct = output ? fn(signature([], ref('Err'))) : fn(signature([parameter('f', ref('Err'))], voidType))
      const throughDefault = (err: TypeExpr) => target(surrounding, taking(ref('Handler')), [alias('Err', err), handler])
      const inPlace = (err: TypeExpr) => target(surrounding, taking(direct), [alias('Err', err)])
      const seen = located(judge(throughDefault(smaller), throughDefault(larger)))
      return seen.bump !== 'none' && same(seen, located(judge(inPlace(smaller), inPlace(larger))))
    },
  )

  it.prop(
    '∀m_ParameterConstraintAlias_≡Changed',
    { of: [ApiModel, ...tags], subject: judge },
    (judge, [surrounding, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const constrained = functionItem({ typeParameters: [{ name: 'T', constraint: ref('Err') }], parameters: [parameter('t', ref('T'))], returns: voidType })
      const result = judge(target(surrounding, constrained, [alias('Err', smaller)]), target(surrounding, constrained, [alias('Err', larger)]))
      return same(reasons(result), { bump: 'major', reasons: ['TYPE_PARAMETERS_CHANGED'] })
    },
  )
})

describe('verdict on a value and a type sharing a name', (it) => {
  const value = (type: TypeExpr): ApiItem => ({ kind: 'variable', name: TARGET, constant: true, type })
  const type = (body: TypeExpr): ApiItem => ({ kind: 'typeAlias', name: TARGET, typeParameters: [], type: body })

  it.prop(
    '∀m_NameValueTypeOrder_≡Unchanged',
    { of: [ApiModel, TypeExpr], subject: judge },
    (judge, [surrounding, body]) => {
      const pair = [value(ref('Schema', body)), type(body)]
      return same(located(judge(rootedWith(surrounding, [...pair].reverse()), rootedWith(surrounding, pair))), verdict('none'))
    },
  )

  it.prop(
    '∀m_NameValueTypePair_≡ItemAlone',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, body, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const beside = value(ref('Schema', body))
      const alone = located(judge(rootedWith(surrounding, [type(smaller)]), rootedWith(surrounding, [type(larger)])))
      const shared = located(judge(rootedWith(surrounding, [beside, type(smaller)]), rootedWith(surrounding, [type(larger), beside])))
      return alone.bump !== 'none' && same(shared, alone)
    },
  )

  it.prop(
    '∀x_ExportKind_≡KindChanged',
    { of: [ApiModel, TypeExpr], subject: judge },
    (judge, [surrounding, body]) => {
      const result = judge(rootedWith(surrounding, [value(body), type(body)]), rootedWith(surrounding, [returning(body), type(body)]))
      return same(located(result), verdict('major', ['EXPORT_KIND_CHANGED', [`.:${TARGET}`]]))
    },
  )
})

describe('verdict on exports sharing a name and a kind', (it) => {
  it.prop(
    '∀m_SameKindPair_≡Unchanged',
    { of: [ApiModel, TypeExpr, TypeExpr], subject: judge },
    (judge, [surrounding, first, second]) => {
      const pair = [returning(first), returning(second)]
      return same(located(judge(rootedWith(surrounding, pair), rootedWith(surrounding, [...pair].reverse()))), verdict('none'))
    },
  )

  it.prop(
    '∀m_SameKindPair_≡ItemAlone',
    { of: [ApiModel, TypeExpr, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, beside, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const [from, to] = [returning(effect(value, smaller)), returning(effect(value, larger))]
      const alone = located(judge(target(surrounding, from), target(surrounding, to)))
      const shared = located(judge(rootedWith(surrounding, [returning(beside), from]), rootedWith(surrounding, [to, returning(beside)])))
      return alone.bump !== 'none' && same(shared, alone)
    },
  )
})

describe('verdict invariants', (it) => {
  it.prop('∀m_ApiModel_≡SelfUnchanged', { of: [ApiModel], subject: judge }, (judge, [model]) =>
    same(located(judge(model, model)), verdict('none')))

  it.prop(
    '∀m_Verdict_≡HighestBump',
    { of: [ApiModel, ApiModel, TypeExpr], subject: judge },
    (judge, [before, after, value]) => {
      const result = judge(rooted(before), rooted(after))
      const more = judge(rooted(before), withExport(rooted(after), returning(value)))
      return (
        Result.isSuccess(result) &&
        Result.isSuccess(more) &&
        result.success.bump === bumpOf(result.success.findings) &&
        maxBump(more.success.bump, result.success.bump) === more.success.bump
      )
    },
  )

  it.prop(
    '∀m_UnclassifiedChange_≡MajorNeverDropped',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const partial = { ...defaultCorpus, rules: defaultCorpus.rules.filter((rule) => rule.match.kind !== 'type-changed') }
      const result = judge(target(surrounding, returning(effect(value, smaller))), target(surrounding, returning(effect(value, larger))), partial)
      return same(reasons(result), { bump: 'major', reasons: ['UNCLASSIFIED_CHANGE'] })
    },
  )

  const ruleIndex = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: defaultCorpus.rules.length - 1 }))
  const withRule = (extra: Rule): RuleCorpus => ({ ...defaultCorpus, rules: [...defaultCorpus.rules, extra] })

  it.prop(
    '∀c_Corpus_⊥TiedMatch',
    { of: [ruleIndex, ApiModel], subject: judge },
    (judge, [index, model]) =>
      Option.match(Arr.get(defaultCorpus.rules, index), {
        onNone: () => false,
        onSome: (rule) => {
          const match = [rule.match.kind, rule.match.position ?? '*', rule.match.channel ?? '*', rule.match.direction ?? '*'].join('|')
          return same(located(judge(model, model, withRule({ ...rule, rule_id: `${rule.rule_id}-copy` }))), refused(`two rules match ${match}`))
        },
      }),
  )

  it.prop(
    '∀c_Corpus_⊥TiedOverlap',
    { of: [ApiModel], subject: judge },
    (judge, [model]) => {
      const byPosition = { ...UNCLASSIFIED, rule_id: 'by-position', match: { kind: 'export-added' as const, position: 'out' as const } }
      const byChannel = { ...UNCLASSIFIED, rule_id: 'by-channel', match: { kind: 'export-added' as const, channel: 'E' } }
      const corpus = { ...defaultCorpus, rules: [...defaultCorpus.rules, byPosition, byChannel] }
      return same(located(judge(model, model, corpus)), refused('two rules match export-added|*|E|* and export-added|out|*|*'))
    },
  )

  it.prop(
    '∀c_Corpus_⊥RepeatedRuleId',
    { of: [ruleIndex, ApiModel], subject: judge },
    (judge, [index, model]) =>
      Option.match(Arr.get(defaultCorpus.rules, index), {
        onNone: () => false,
        onSome: (rule) => {
          const apart = { ...rule, match: { kind: 'export-added' as const, position: 'out' as const, channel: 'Q', direction: 'changed' as const } }
          return same(
            [located(judge(model, model, withRule({ ...apart, rule_id: rule.rule_id }))), located(judge(model, model, withRule({ ...apart, rule_id: UNCLASSIFIED.rule_id })))],
            [refused(`duplicate rule id ${rule.rule_id}`), refused(`rule id ${UNCLASSIFIED.rule_id} is reserved for unclassified changes`)],
          )
        },
      }),
  )
})
