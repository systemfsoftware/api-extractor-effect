import { describe } from '@systemfsoftware/vitest'
import { Result, Schema } from 'effect'
import { canonicalJson, compareCodeUnits } from './canonical-json.ts'
import { bumpOf, maxBump, UNCLASSIFIED } from './findings.ts'
import { judgeSurfaces } from './judge-surfaces.workflow.ts'
import { ApiItem, ApiModel, type TypeAliasItem } from './model/api-model.ts'
import { type Signature, TypeExpr } from './model/type-expr.ts'
import { type Bump, type Rule, type RuleCorpus, defaultCorpus } from './rules/corpus.ts'
import { type AmbiguousRuleCorpus, CompareSurfaces, type Verdict } from './verdict.schema.ts'
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
} from '../tests/__fixtures__/surfaces.ts'

type Judged = Result.Result<Verdict, AmbiguousRuleCorpus>
const judge = (before: ApiModel, after: ApiModel, corpus: RuleCorpus = defaultCorpus): Judged =>
  judgeSurfaces(new CompareSurfaces({ before, after, corpus }))

const located = (result: Judged) =>
  Result.isSuccess(result)
    ? { bump: result.success.bump, findings: result.success.findings.map((finding) => [finding.reason_code, finding.locations]) }
    : { refused: result.failure.ambiguities }
const reasons = (result: Judged) =>
  Result.isSuccess(result)
    ? { bump: result.success.bump, reasons: result.success.findings.map((finding) => finding.reason_code) }
    : { refused: result.failure.ambiguities }
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right)
const verdict = (bump: Bump, ...findings: ReadonlyArray<readonly [string, ReadonlyArray<string>]>) => ({ bump, findings })
const refused = (...ambiguities: ReadonlyArray<string>) => ({ refused: ambiguities })

const grown = (first: string, rest: ReadonlyArray<string>) => {
  const labels = [first, ...rest]
  const before = labels.map((label) => ref(`Tag${label}`))
  return { smaller: union(before), larger: union([...before, ref(`Tag${labels.join('')}+`)]) }
}
const tags = [Schema.String, Schema.Array(Schema.String)] as const

const target = (surrounding: ApiModel, item: ApiItem, locals: ReadonlyArray<TypeAliasItem> = []) =>
  rootedWith(surrounding, [item], locals)
const returning = (type: TypeExpr) => functionItem(signature([], type))
const taking = (type: TypeExpr) => functionItem(signature([parameter('self', type)], voidType))
const at = (path: string) => `.:${TARGET}/${path}`

describe('verdict on Effect channels', (it) => {
  it.prop(
    'AE1: a widened error channel in a return type is major E_WIDENED at the return type',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, returning(effect(value, smaller))), target(surrounding, returning(effect(value, larger))))
      return same(located(result), verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    'one rule firing at several exports is one finding listing every location once, in code-unit order',
    { of: [ApiModel, TypeExpr, ...tags, Schema.String, Schema.Array(Schema.String)], subject: judge },
    (judge, [surrounding, value, first, rest, one, others]) => {
      const { smaller, larger } = grown(first, rest)
      const names = [one, `${one}+`, ...others].map((label, index) => `fn${index}:${label}`)
      const exportsOf = (failure: TypeExpr) =>
        rootedWith(surrounding, names.map((name) => ({ ...returning(effect(value, failure)), name })))
      return same(
        located(judge(exportsOf(smaller), exportsOf(larger))),
        verdict('major', ['E_WIDENED', names.map((name) => `.:${name}/signature[0]/returns/E`).sort(compareCodeUnits)]),
      )
    },
  )

  it.prop(
    'removing a tagged error from a returned error channel is major E_TAG_REMOVED',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, returning(effect(value, larger))), target(surrounding, returning(effect(value, smaller))))
      return same(located(result), verdict('major', ['E_TAG_REMOVED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    'AE2: a widened error channel in a parameter is minor E_WIDENED_IN_INPUT',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const result = judge(target(surrounding, taking(effect(value, smaller))), target(surrounding, taking(effect(value, larger))))
      return same(located(result), verdict('minor', ['E_WIDENED_IN_INPUT', [at('signature[0]/parameter[0]/E')]]))
    },
  )

  it.prop(
    'a callback parameter flips position twice: its error channel is an output again',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const surface = (slot: TypeExpr) => target(surrounding, taking(fn(signature([parameter('event', effect(value, slot))], voidType))))
      return same(located(judge(surface(smaller), surface(larger))), verdict('major', ['E_WIDENED', [at('signature[0]/parameter[0]/parameter[0]/E')]]))
    },
  )

  it.prop(
    'sees a widened error through a local type alias at the function that uses it',
    { of: [ApiModel, TypeExpr, ...tags], subject: judge },
    (judge, [surrounding, value, first, rest]) => {
      const { smaller, larger } = grown(first, rest)
      const item = returning(effect(value, ref('Err')))
      const result = judge(target(surrounding, item, [alias('Err', smaller)]), target(surrounding, item, [alias('Err', larger)]))
      return same(located(result), verdict('major', ['E_WIDENED', [at('signature[0]/returns/E')]]))
    },
  )

  it.prop(
    'reads Layer output services contravariantly: a removed service is major, an added one minor',
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
    'AE3: losing either call form of a dual is major DUAL_FORM_REMOVED',
    { of: [ApiModel, TypeExpr, TypeExpr, Schema.Boolean], subject: judge },
    (judge, [surrounding, value, failure, dropDataLast]) => {
      const { dataLast, dataFirst } = dual(value, failure)
      const result = judge(target(surrounding, constant(dataLast, dataFirst)), target(surrounding, constant(dropDataLast ? dataFirst : dataLast)))
      return same(located(result), verdict('major', ['DUAL_FORM_REMOVED', [at(`call/signature[${dropDataLast ? 0 : 1}]`)]]))
    },
  )

  it.prop(
    'adding the missing call form of a dual is minor DUAL_FORM_ADDED',
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
    'a removed export is major and an added export minor',
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
    'a new required parameter is major; a new optional one is minor',
    { of: [ApiModel, TypeExpr, Schema.Boolean], subject: judge },
    (judge, [surrounding, value, optional]) => {
      const result = judge(target(surrounding, returning(value)), target(surrounding, functionItem(signature([parameter('extra', value, optional)], value))))
      return same(reasons(result), optional ? { bump: 'minor', reasons: ['OPTIONAL_PARAMETER_ADDED'] } : { bump: 'major', reasons: ['REQUIRED_PARAMETER_ADDED'] })
    },
  )

  it.prop(
    'an entry point removed is major and one added is minor',
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
    'AE1 and AE2 hold for the two-argument spelling Effect<A, E>',
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
    'a left-out channel is its default: Effect<A> equals Effect<A, never, never>, and gaining an error widens E',
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
    'reads a two-argument Layer by its channels: a removed service is major',
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
    'an alias reached through a type-parameter default is seen as if written in place',
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
    'a changed alias in a type-parameter constraint changes the type parameters',
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
    'has no changes against itself, whatever order the two items come in',
    { of: [ApiModel, TypeExpr], subject: judge },
    (judge, [surrounding, body]) => {
      const pair = [value(ref('Schema', body)), type(body)]
      return same(located(judge(rootedWith(surrounding, [...pair].reverse()), rootedWith(surrounding, pair))), verdict('none'))
    },
  )

  it.prop(
    'judges a change to one of them as that item alone would be judged',
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
    'a value that becomes a function beside an unchanged type is one EXPORT_KIND_CHANGED',
    { of: [ApiModel, TypeExpr], subject: judge },
    (judge, [surrounding, body]) => {
      const result = judge(rootedWith(surrounding, [value(body), type(body)]), rootedWith(surrounding, [returning(body), type(body)]))
      return same(located(result), verdict('major', ['EXPORT_KIND_CHANGED', [`.:${TARGET}`]]))
    },
  )
})

describe('verdict on exports sharing a name and a kind', (it) => {
  it.prop(
    'has no changes between two models storing them in either order',
    { of: [ApiModel, TypeExpr, TypeExpr], subject: judge },
    (judge, [surrounding, first, second]) => {
      const pair = [returning(first), returning(second)]
      return same(located(judge(rootedWith(surrounding, pair), rootedWith(surrounding, [...pair].reverse()))), verdict('none'))
    },
  )

  it.prop(
    'judges a change to one of them as that export alone would be judged, whatever order they are stored in',
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
  it.prop('a model has no changes against itself', { of: [ApiModel], subject: judge }, (judge, [model]) =>
    same(located(judge(model, model)), verdict('none')))

  it.prop(
    'the verdict is the highest finding bump, and an extra change never lowers it',
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
    'AE4: a change no rule covers is reported major UNCLASSIFIED_CHANGE, never dropped',
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
    'refuses a corpus in which two rules match the same change, naming the match',
    { of: [ruleIndex, ApiModel], subject: judge },
    (judge, [index, model]) => {
      const rule = defaultCorpus.rules[index]!
      const match = [rule.match.kind, rule.match.position ?? '*', rule.match.channel ?? '*', rule.match.direction ?? '*'].join('|')
      return same(located(judge(model, model, withRule({ ...rule, rule_id: `${rule.rule_id}-copy` }))), refused(`two rules match ${match}`))
    },
  )

  it.prop(
    'refuses a corpus in which two rules tie on some change without sharing a match',
    { of: [ApiModel], subject: judge },
    (judge, [model]) => {
      const byPosition = { ...UNCLASSIFIED, rule_id: 'by-position', match: { kind: 'export-added' as const, position: 'out' as const } }
      const byChannel = { ...UNCLASSIFIED, rule_id: 'by-channel', match: { kind: 'export-added' as const, channel: 'E' } }
      const corpus = { ...defaultCorpus, rules: [...defaultCorpus.rules, byPosition, byChannel] }
      return same(located(judge(model, model, corpus)), refused('two rules match export-added|*|E|* and export-added|out|*|*'))
    },
  )

  it.prop(
    'refuses a corpus that repeats a rule id, or takes the id unclassified changes are reported under',
    { of: [ruleIndex, ApiModel], subject: judge },
    (judge, [index, model]) => {
      const rule = defaultCorpus.rules[index]!
      const apart = { ...rule, match: { kind: 'export-added' as const, position: 'out' as const, channel: 'Q', direction: 'changed' as const } }
      return same(
        [located(judge(model, model, withRule({ ...apart, rule_id: rule.rule_id }))), located(judge(model, model, withRule({ ...apart, rule_id: UNCLASSIFIED.rule_id })))],
        [refused(`duplicate rule id ${rule.rule_id}`), refused(`rule id ${UNCLASSIFIED.rule_id} is reserved for unclassified changes`)],
      )
    },
  )
})
