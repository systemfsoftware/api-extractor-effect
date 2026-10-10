import { Result } from 'effect'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compareCodeUnits } from './canonical-json.ts'
import { diffModels } from './diff/diff.ts'
import { bumpOf, maxBump, UNCLASSIFIED } from './findings.ts'
import { judgeSurfaces } from './judge-surfaces.workflow.ts'
import { type Rule, type RuleCorpus, defaultCorpus } from './rules/corpus.ts'
import { CompareSurfaces, type Verdict } from './verdict.schema.ts'
import type { ApiItem, ApiModel, TypeAliasItem } from './model/api-model.ts'
import type { Member, Signature, TypeExpr } from './model/type-expr.ts'
import { apiModel, items, name } from '../tests/__fixtures__/arbitraries.ts'
import {
  alias,
  effect,
  fn,
  functionItem,
  never,
  parameter,
  ref,
  rooted,
  signature,
  TARGET,
  union,
  voidType,
  withExport,
} from '../tests/__fixtures__/surfaces.ts'

/** Distinct error tags; the `Tag` prefix keeps them apart from generated names. */
const tags = (min: number) => fc.uniqueArray(name.map((tag) => ref(`Tag${tag}`)), { minLength: min, maxLength: 4, selector: (tag) => (tag as { name: string }).name })
const success = name.map((value) => ref(`User${value}`))

/** A channel's members before, and after some were added; `widened` reads after-from-before. */
const grown = fc
  .tuple(tags(2), fc.integer({ min: 1, max: 3 }))
  .map(([all, cut]) => {
    const keep = Math.min(cut, all.length - 1)
    return { smaller: union(all.slice(0, keep)), larger: union(all) }
  })

/** The verdict decision on two surfaces; these properties are about judged corpora, so a refusal fails the test. */
const judged = (before: ApiModel, after: ApiModel, corpus: RuleCorpus = defaultCorpus): Verdict =>
  Result.getOrThrow(judgeSurfaces(new CompareSurfaces({ before, after, corpus })))

describe('verdict on Effect channels', () => {
  it('AE1: a widened error channel in a return type is major E_WIDENED at the return type', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const result = judged(before, after)
        expect(result.bump).toBe('major')
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED', [`.:${TARGET}/signature[0]/returns/E`]],
        ])
      }),
    )
  })

  it('one rule firing at several exports is one finding listing every location once, in code-unit order', () => {
    fc.assert(
      fc.property(apiModel, success, grown, fc.uniqueArray(name, { minLength: 2, maxLength: 4 }), (surrounding, value, { smaller, larger }, names) => {
        const exportsOf = (failure: TypeExpr) => (model: ApiModel) =>
          names.reduce((acc, exported) => withExport(acc, { ...functionItem(signature([], effect(value, failure))), name: `fn${exported}` }), model)
        const result = judged(exportsOf(smaller)(surrounding), exportsOf(larger)(surrounding))
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED', names.map((exported) => `.:fn${exported}/signature[0]/returns/E`).sort(compareCodeUnits)],
        ])
      }),
    )
  })

  it('removing a tagged error from a returned error channel is major E_TAG_REMOVED', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const result = judged(before, after)
        expect(result.bump).toBe('major')
        expect(result.findings.map((finding) => finding.reason_code)).toEqual(['E_TAG_REMOVED'])
      }),
    )
  })

  it('AE2: a widened error channel in a parameter is minor', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([parameter('self', effect(value, smaller))], voidType)))
        const after = withExport(surrounding, functionItem(signature([parameter('self', effect(value, larger))], voidType)))
        const result = judged(before, after)
        expect(result.bump).toBe('minor')
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED_IN_INPUT', [`.:${TARGET}/signature[0]/parameter[0]/E`]],
        ])
      }),
    )
  })

  /** The independent oracle: which channel moves break a consumer, by position. */
  const expectations = [
    ['A', 'out', 'widened', 'major', 'A_WIDENED'],
    ['A', 'out', 'narrowed', 'minor', 'A_NARROWED'],
    ['A', 'in', 'widened', 'minor', 'A_WIDENED_IN_INPUT'],
    ['A', 'in', 'narrowed', 'major', 'A_NARROWED_IN_INPUT'],
    ['E', 'out', 'widened', 'major', 'E_WIDENED'],
    ['E', 'out', 'narrowed', 'major', 'E_TAG_REMOVED'],
    ['E', 'in', 'widened', 'minor', 'E_WIDENED_IN_INPUT'],
    ['E', 'in', 'narrowed', 'major', 'E_NARROWED_IN_INPUT'],
    ['R', 'out', 'widened', 'major', 'R_WIDENED'],
    ['R', 'out', 'narrowed', 'minor', 'R_NARROWED'],
    ['R', 'in', 'widened', 'minor', 'R_WIDENED_IN_INPUT'],
    ['R', 'in', 'narrowed', 'major', 'R_NARROWED_IN_INPUT'],
  ] as const

  it.each(expectations)('%s channel %s %s is %s %s', (channel, position, moved, bump, reason) => {
    fc.assert(
      fc.property(apiModel, success, tags(1), grown, (surrounding, value, failure, { smaller, larger }) => {
        const [from, to] = moved === 'widened' ? [smaller, larger] : [larger, smaller]
        const build = (slot: TypeExpr): TypeExpr =>
          channel === 'A' ? effect(slot, union(failure)) : channel === 'E' ? effect(value, slot) : effect(value, union(failure), slot)
        const surface = (slot: TypeExpr) =>
          functionItem(position === 'out' ? signature([], build(slot)) : signature([parameter('self', build(slot))], voidType))
        const result = judged(withExport(surrounding, surface(from)), withExport(surrounding, surface(to)))
        expect(result.bump).toBe(bump)
        expect(result.findings.map((finding) => finding.reason_code)).toEqual([reason])
        expect(result.findings[0]?.locations[0]?.endsWith(`/${channel}`)).toBe(true)
      }),
      { numRuns: 30 },
    )
  })

  it('a callback parameter flips position twice: its error channel is an output again', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const surface = (slot: TypeExpr) =>
          functionItem(signature([parameter('handler', fn(signature([parameter('event', effect(value, slot))], voidType)))], voidType))
        const result = judged(withExport(surrounding, surface(smaller)), withExport(surrounding, surface(larger)))
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED', [`.:${TARGET}/signature[0]/parameter[0]/parameter[0]/E`]],
        ])
      }),
    )
  })

  it('sees a widened error through a local type alias at the function that uses it', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const item = functionItem(signature([], effect(value, ref('Err'))))
        const before = withExport(surrounding, item, [alias('Err', smaller)])
        const after = withExport(surrounding, item, [alias('Err', larger)])
        const result = judged(before, after)
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED', [`.:${TARGET}/signature[0]/returns/E`]],
        ])
      }),
    )
  })

  it('reads Layer output services contravariantly: a removed service is major, an added one minor', () => {
    fc.assert(
      fc.property(apiModel, tags(1), grown, (surrounding, failure, { smaller, larger }) => {
        const layer = (services: TypeExpr) => functionItem(signature([], ref('Layer', services, union(failure), never)))
        const removed = judged(withExport(surrounding, layer(larger)), withExport(surrounding, layer(smaller)))
        const added = judged(withExport(surrounding, layer(smaller)), withExport(surrounding, layer(larger)))
        expect([removed.bump, removed.findings.map((finding) => finding.reason_code)]).toEqual(['major', ['LAYER_SERVICE_REMOVED']])
        expect([added.bump, added.findings.map((finding) => finding.reason_code)]).toEqual(['minor', ['LAYER_SERVICE_ADDED']])
      }),
    )
  })
})

describe('verdict on dual APIs', () => {
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

  it('AE3: losing either call form of a dual is major DUAL_FORM_REMOVED', () => {
    fc.assert(
      fc.property(apiModel, success, tags(1), fc.boolean(), (surrounding, value, failure, dropDataLast) => {
        const { dataLast, dataFirst } = dual(value, union(failure))
        const before = withExport(surrounding, constant(dataLast, dataFirst))
        const after = withExport(surrounding, constant(dropDataLast ? dataFirst : dataLast))
        const result = judged(before, after)
        expect(result.bump).toBe('major')
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['DUAL_FORM_REMOVED', [`.:${TARGET}/call/signature[${dropDataLast ? 0 : 1}]`]],
        ])
      }),
    )
  })

  it('adding the missing call form of a dual is minor DUAL_FORM_ADDED', () => {
    fc.assert(
      fc.property(apiModel, success, tags(1), (surrounding, value, failure) => {
        const { dataLast, dataFirst } = dual(value, union(failure))
        const result = judged(withExport(surrounding, constant(dataFirst)), withExport(surrounding, constant(dataLast, dataFirst)))
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual(['minor', ['DUAL_FORM_ADDED']])
      }),
    )
  })
})

describe('verdict on exports and parameters', () => {
  const someItem = items.filter((list) => list.length > 0).map((list) => ({ ...list[0]!, name: TARGET }))

  it('a removed export is major and an added export minor', () => {
    fc.assert(
      fc.property(apiModel, someItem, (surrounding, item) => {
        const base = rooted(surrounding)
        const withTarget = withExport(base, item)
        expect(judged(withTarget, base).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['EXPORT_REMOVED', 'major']])
        expect(judged(base, withTarget).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['EXPORT_ADDED', 'minor']])
      }),
    )
  })

  it('a new required parameter is major; a new optional one is minor', () => {
    fc.assert(
      fc.property(apiModel, success, fc.boolean(), (surrounding, value, optional) => {
        const before = withExport(surrounding, functionItem(signature([], value)))
        const after = withExport(surrounding, functionItem(signature([parameter('extra', value, optional)], value)))
        const result = judged(before, after)
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual(
          optional ? ['minor', ['OPTIONAL_PARAMETER_ADDED']] : ['major', ['REQUIRED_PARAMETER_ADDED']],
        )
      }),
    )
  })
})

describe('verdict on Effect types spelled with defaulted channels', () => {
  it('AE1 and AE2 hold for the two-argument spelling Effect<A, E>', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const returning = (failure: TypeExpr) => functionItem(signature([], ref('Effect', value, failure)))
        const taking = (failure: TypeExpr) => functionItem(signature([parameter('self', ref('Effect', value, failure))], voidType))
        const out = judged(withExport(surrounding, returning(smaller)), withExport(surrounding, returning(larger)))
        const input = judged(withExport(surrounding, taking(smaller)), withExport(surrounding, taking(larger)))
        expect([out.bump, out.findings.map((finding) => [finding.reason_code, finding.locations])]).toEqual([
          'major',
          [['E_WIDENED', [`.:${TARGET}/signature[0]/returns/E`]]],
        ])
        expect([input.bump, input.findings.map((finding) => finding.reason_code)]).toEqual(['minor', ['E_WIDENED_IN_INPUT']])
      }),
    )
  })

  it('a left-out channel is its default: Effect<A> equals Effect<A, never, never>, and gaining an error widens E', () => {
    fc.assert(
      fc.property(apiModel, success, tags(1), (surrounding, value, failure) => {
        const returning = (type: TypeExpr) => withExport(surrounding, functionItem(signature([], type)))
        expect(judged(returning(ref('Effect', value)), returning(effect(value, never))).bump).toBe('none')
        const gained = judged(returning(ref('Effect', value)), returning(ref('Effect', value, union(failure))))
        expect(gained.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([['E_WIDENED', [`.:${TARGET}/signature[0]/returns/E`]]])
      }),
    )
  })

  it('reads a two-argument Layer by its channels: a removed service is major', () => {
    fc.assert(
      fc.property(apiModel, tags(1), grown, (surrounding, failure, { smaller, larger }) => {
        const layer = (services: TypeExpr) => functionItem(signature([], ref('Layer', services, union(failure))))
        const removed = judged(withExport(surrounding, layer(larger)), withExport(surrounding, layer(smaller)))
        expect([removed.bump, removed.findings.map((finding) => finding.reason_code)]).toEqual(['major', ['LAYER_SERVICE_REMOVED']])
      }),
    )
  })
})

describe('verdict through local type aliases', () => {
  const generic = (name: string, parameterName: string, defaultType: TypeExpr, type: TypeExpr): TypeAliasItem => ({
    kind: 'typeAlias',
    name,
    typeParameters: [{ name: parameterName, default: defaultType }],
    type,
  })

  it('an alias reached through a type-parameter default is seen as if written in place', () => {
    fc.assert(
      fc.property(apiModel, grown, fc.boolean(), (surrounding, { smaller, larger }, output) => {
        // `type Handler<F = Err> = () => F` (or `(f: F) => void`), used bare by the export.
        const handler = generic('Handler', 'F', ref('Err'), output ? fn(signature([], ref('F'))) : fn(signature([parameter('f', ref('F'))], voidType)))
        const direct = output ? fn(signature([], ref('Err'))) : fn(signature([parameter('f', ref('Err'))], voidType))
        const surface = (type: TypeExpr) => functionItem(signature([parameter('h', type)], voidType))
        const throughDefault = (err: TypeExpr) => withExport(surrounding, surface(ref('Handler')), [alias('Err', err), handler])
        const inPlace = (err: TypeExpr) => withExport(surrounding, surface(direct), [alias('Err', err)])
        const seen = judged(throughDefault(smaller), throughDefault(larger))
        expect(seen.findings).toEqual(judged(inPlace(smaller), inPlace(larger)).findings)
        expect(seen.bump).not.toBe('none')
      }),
    )
  })

  it('a changed alias in a type-parameter constraint changes the type parameters', () => {
    fc.assert(
      fc.property(apiModel, grown, (surrounding, { smaller, larger }) => {
        const constrained = functionItem({ typeParameters: [{ name: 'T', constraint: ref('Err') }], parameters: [parameter('t', ref('T'))], returns: voidType })
        const result = judged(withExport(surrounding, constrained, [alias('Err', smaller)]), withExport(surrounding, constrained, [alias('Err', larger)]))
        expect(result.findings.map((finding) => finding.reason_code)).toEqual(['TYPE_PARAMETERS_CHANGED'])
      }),
    )
  })
})

describe('verdict on a value and a type sharing a name', () => {
  const value = (type: TypeExpr): ApiItem => ({ kind: 'variable', name: TARGET, constant: true, type })
  const type = (body: TypeExpr): ApiItem => ({ kind: 'typeAlias', name: TARGET, typeParameters: [], type: body })
  const both = (model: ApiModel, items: ReadonlyArray<ApiItem>): ApiModel => {
    const base = rooted(model)
    return {
      ...base,
      entryPoints: base.entryPoints.map((entry) => (entry.path === '.' ? { ...entry, items: [...entry.items, ...items] } : entry)),
    }
  }

  it('has no changes against itself, whatever order the two items come in', () => {
    fc.assert(
      fc.property(apiModel, success, fc.boolean(), (surrounding, body, reversed) => {
        const pair = [value(ref('Schema', body)), type(body)]
        const model = both(surrounding, reversed ? [...pair].reverse() : pair)
        expect(diffModels(model, both(surrounding, pair), defaultCorpus.channelTypes)).toEqual([])
      }),
    )
  })

  it('judges a change to one of them as that item alone would be judged', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, body, { smaller, larger }) => {
        const beside = value(ref('Schema', body))
        const alone = judged(both(surrounding, [type(smaller)]), both(surrounding, [type(larger)]))
        const shared = judged(both(surrounding, [beside, type(smaller)]), both(surrounding, [type(larger), beside]))
        expect(shared.findings).toEqual(alone.findings)
      }),
    )
  })

  it('a value that becomes a function beside an unchanged type is one EXPORT_KIND_CHANGED', () => {
    fc.assert(
      fc.property(apiModel, success, (surrounding, body) => {
        const result = judged(both(surrounding, [value(body), type(body)]), both(surrounding, [functionItem(signature([], body)), type(body)]))
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([['EXPORT_KIND_CHANGED', [`.:${TARGET}`]]])
      }),
    )
  })
})

describe('verdict on each change kind', () => {
  const classItem = (overrides: Partial<ApiItem & { kind: 'class' }> = {}): ApiItem => ({
    kind: 'class',
    name: TARGET,
    abstract: false,
    typeParameters: [],
    extends: [],
    implements: [],
    members: [],
    ...overrides,
  })
  const property = (name: string, type: TypeExpr): Member => ({ kind: 'property', name, optional: false, readonly: false, type })
  const method = (name: string, returns: TypeExpr): Member => ({ kind: 'method', name, optional: false, signatures: [signature([], returns)] })
  const enumItem = (...members: ReadonlyArray<string>): ApiItem => ({ kind: 'enum', name: TARGET, const: false, members: members.map((name) => ({ name })) })
  const callback = (...parameters: ReadonlyArray<ReturnType<typeof parameter>>) => functionItem(signature([parameter('cb', fn(signature(parameters, voidType)))], voidType))
  const restParameter = { ...parameter('rest', ref('Arr')), rest: true }

  /** The independent oracle: what each surface change does to a consumer that compiled against the old one. */
  const table: ReadonlyArray<readonly [string, ApiItem, ApiItem, 'major' | 'minor', string]> = [
    ['an overload is dropped', functionItem(signature([], ref('A')), signature([parameter('x', ref('X'))], ref('A'))), functionItem(signature([], ref('A'))), 'major', 'OVERLOAD_REMOVED'],
    ['an overload is added', functionItem(signature([], ref('A'))), functionItem(signature([], ref('A')), signature([parameter('x', ref('X'))], ref('A'))), 'minor', 'OVERLOAD_ADDED'],
    ['a parameter is removed', functionItem(signature([parameter('x', ref('X'))], voidType)), functionItem(signature([], voidType)), 'major', 'PARAMETER_REMOVED'],
    ['a parameter becomes optional', functionItem(signature([parameter('x', ref('X'))], voidType)), functionItem(signature([parameter('x', ref('X'), true)], voidType)), 'minor', 'PARAMETER_BECAME_OPTIONAL'],
    ['a parameter becomes required', functionItem(signature([parameter('x', ref('X'), true)], voidType)), functionItem(signature([parameter('x', ref('X'))], voidType)), 'major', 'PARAMETER_BECAME_REQUIRED'],
    ['a parameter becomes a rest parameter', functionItem(signature([parameter('rest', ref('Arr'))], voidType)), functionItem(signature([restParameter], voidType)), 'major', 'PARAMETER_REST_CHANGED'],
    ['a callback is handed a new parameter', callback(), callback(parameter('x', ref('X'))), 'minor', 'CALLBACK_PARAMETER_ADDED'],
    ['a callback parameter becomes optional', callback(parameter('x', ref('X'))), callback(parameter('x', ref('X'), true)), 'major', 'CALLBACK_PARAMETER_BECAME_OPTIONAL'],
    ['a member is removed', classItem({ members: [property('p', ref('P'))] }), classItem(), 'major', 'MEMBER_REMOVED'],
    ['a property becomes a method', classItem({ members: [property('p', ref('P'))] }), classItem({ members: [method('p', ref('P'))] }), 'major', 'MEMBER_KIND_CHANGED'],
    ['a class becomes abstract', classItem(), classItem({ abstract: true }), 'major', 'CLASS_BECAME_ABSTRACT'],
    ['a class becomes concrete', classItem({ abstract: true }), classItem(), 'minor', 'CLASS_BECAME_CONCRETE'],
    ['a base class becomes an implemented interface', classItem({ extends: [ref('Base')] }), classItem({ implements: [ref('Base')] }), 'major', 'HERITAGE_CHANGED'],
    ['an implemented interface is dropped', classItem({ implements: [ref('Iface')] }), classItem(), 'major', 'HERITAGE_CHANGED'],
    ['a type parameter is added', classItem(), classItem({ typeParameters: [{ name: 'T' }] }), 'major', 'TYPE_PARAMETERS_CHANGED'],
    ['an enum member is removed', enumItem('A', 'B'), enumItem('A'), 'major', 'ENUM_MEMBER_REMOVED'],
    ['an enum member is added', enumItem('A'), enumItem('A', 'B'), 'minor', 'ENUM_MEMBER_ADDED'],
    ['a return type is replaced by an unrelated one', functionItem(signature([], ref('A'))), functionItem(signature([], ref('B'))), 'major', 'TYPE_CHANGED'],
  ]

  it.each(table.map(([label, before, after, bump, reason]) => ({ label, before, after, bump, reason })))('$label is $bump $reason', ({ before, after, bump, reason }) => {
    fc.assert(
      fc.property(apiModel, (surrounding) => {
        const result = judged(withExport(surrounding, before), withExport(surrounding, after))
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual([bump, [reason]])
      }),
      { numRuns: 20 },
    )
  })

  it('an entry point removed is major and one added is minor', () => {
    fc.assert(
      fc.property(apiModel, name, (model, segment) => {
        const extra = { path: `./extra-${segment}`, items: [], locals: [] }
        const without = { ...model, entryPoints: model.entryPoints.filter((entry) => entry.path !== extra.path) }
        const withExtra = { ...without, entryPoints: [...without.entryPoints, extra] }
        expect(judged(withExtra, without).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['ENTRY_POINT_REMOVED', 'major']])
        expect(judged(without, withExtra).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['ENTRY_POINT_ADDED', 'minor']])
      }),
    )
  })
})

describe('verdict invariants', () => {
  it('a model has no changes against itself', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        expect(diffModels(model, model, defaultCorpus.channelTypes)).toEqual([])
        expect(judged(model, model).bump).toBe('none')
      }),
    )
  })

  it('the verdict is the highest finding bump, and an extra change never lowers it', () => {
    fc.assert(
      fc.property(apiModel.map(rooted), apiModel.map(rooted), success, (before, after, value) => {
        const result = judged(before, after)
        expect(result.bump).toBe(bumpOf(result.findings))
        const more = judged(before, withExport(after, functionItem(signature([], value))))
        expect(maxBump(more.bump, result.bump)).toBe(more.bump)
      }),
    )
  })

  it('AE4: a change no rule covers is reported major UNCLASSIFIED_CHANGE, never dropped', () => {
    const partial = { ...defaultCorpus, rules: defaultCorpus.rules.filter((rule) => rule.match.kind !== 'type-changed') }
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const result = judged(before, after, partial)
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual(['major', ['UNCLASSIFIED_CHANGE']])
      }),
    )
  })

  it('refuses a corpus in which two rules match the same change, naming the match', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: defaultCorpus.rules.length - 1 }), apiModel, (index, model) => {
        const rule = defaultCorpus.rules[index]!
        const corpus = { ...defaultCorpus, rules: [...defaultCorpus.rules, { ...rule, rule_id: `${rule.rule_id}-copy` }] }
        const refusal = Result.flip(judgeSurfaces(new CompareSurfaces({ before: model, after: model, corpus })))
        expect(Result.getOrThrow(refusal).ambiguities).toEqual([
          `two rules match ${[rule.match.kind, rule.match.position ?? '*', rule.match.channel ?? '*', rule.match.direction ?? '*'].join('|')}`,
        ])
      }),
    )
  })

  it('refuses a corpus in which two rules tie on some change without sharing a match', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        const byPosition = { ...UNCLASSIFIED, rule_id: 'by-position', match: { kind: 'export-added' as const, position: 'out' as const } }
        const byChannel = { ...UNCLASSIFIED, rule_id: 'by-channel', match: { kind: 'export-added' as const, channel: 'E' } }
        const corpus = { ...defaultCorpus, rules: [...defaultCorpus.rules, byPosition, byChannel] }
        const refusal = Result.flip(judgeSurfaces(new CompareSurfaces({ before: model, after: model, corpus })))
        expect(Result.getOrThrow(refusal).ambiguities).toEqual(['two rules match export-added|*|E|* and export-added|out|*|*'])
      }),
      { numRuns: 5 },
    )
  })

  it('refuses a corpus that repeats a rule id, or takes the id unclassified changes are reported under', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: defaultCorpus.rules.length - 1 }), apiModel, (index, model) => {
        const rule = defaultCorpus.rules[index]!
        const refused = (extra: Rule) =>
          Result.getOrThrow(Result.flip(judgeSurfaces(new CompareSurfaces({ before: model, after: model, corpus: { ...defaultCorpus, rules: [...defaultCorpus.rules, extra] } })))).ambiguities
        // A rule no change can tie with: a kind the diff emits, at a channel no rule names.
        const apart = { ...rule, match: { kind: 'export-added' as const, position: 'out' as const, channel: 'Q', direction: 'changed' as const } }
        expect(refused({ ...apart, rule_id: rule.rule_id })).toEqual([`duplicate rule id ${rule.rule_id}`])
        expect(refused({ ...apart, rule_id: UNCLASSIFIED.rule_id })).toEqual([`rule id ${UNCLASSIFIED.rule_id} is reserved for unclassified changes`])
      }),
      { numRuns: 20 },
    )
  })
})
