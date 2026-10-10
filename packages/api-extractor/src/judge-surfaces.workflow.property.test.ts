import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diffModels } from '../src/diff/diff.ts'
import { type Bump, decodeRuleCorpus, defaultCorpus } from '../src/rules/corpus.ts'
import { maxBump, verdict } from '../src/verdict.ts'
import type { ApiItem } from '../src/model/api-model.ts'
import type { Signature, TypeExpr } from '../src/model/type-expr.ts'
import { apiModel, items, name } from './__fixtures__/arbitraries.ts'
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
} from './__fixtures__/surfaces.ts'

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

const BUMP_ORDER = ['none', 'patch', 'minor', 'major'] as const

describe('verdict on Effect channels', () => {
  it('AE1: a widened error channel in a return type is major E_WIDENED at the return type', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const result = verdict(before, after)
        expect(result.bump).toBe('major')
        expect(result.findings.map((finding) => [finding.reason_code, finding.locations])).toEqual([
          ['E_WIDENED', [`.:${TARGET}/signature[0]/returns/E`]],
        ])
      }),
    )
  })

  it('removing a tagged error from a returned error channel is major E_TAG_REMOVED', () => {
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const result = verdict(before, after)
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
        const result = verdict(before, after)
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
        const result = verdict(withExport(surrounding, surface(from)), withExport(surrounding, surface(to)))
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
        const result = verdict(withExport(surrounding, surface(smaller)), withExport(surrounding, surface(larger)))
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
        const result = verdict(before, after)
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
        const removed = verdict(withExport(surrounding, layer(larger)), withExport(surrounding, layer(smaller)))
        const added = verdict(withExport(surrounding, layer(smaller)), withExport(surrounding, layer(larger)))
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
        const result = verdict(before, after)
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
        const result = verdict(withExport(surrounding, constant(dataFirst)), withExport(surrounding, constant(dataLast, dataFirst)))
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
        expect(verdict(withTarget, base).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['EXPORT_REMOVED', 'major']])
        expect(verdict(base, withTarget).findings.map((finding) => [finding.reason_code, finding.bump])).toEqual([['EXPORT_ADDED', 'minor']])
      }),
    )
  })

  it('a new required parameter is major; a new optional one is minor', () => {
    fc.assert(
      fc.property(apiModel, success, fc.boolean(), (surrounding, value, optional) => {
        const before = withExport(surrounding, functionItem(signature([], value)))
        const after = withExport(surrounding, functionItem(signature([parameter('extra', value, optional)], value)))
        const result = verdict(before, after)
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual(
          optional ? ['minor', ['OPTIONAL_PARAMETER_ADDED']] : ['major', ['REQUIRED_PARAMETER_ADDED']],
        )
      }),
    )
  })
})

describe('verdict invariants', () => {
  it('a model has no changes against itself', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        expect(diffModels(model, model, defaultCorpus.channelTypes)).toEqual([])
        expect(verdict(model, model).bump).toBe('none')
      }),
    )
  })

  it('the verdict is the highest finding bump, and an extra change never lowers it', () => {
    fc.assert(
      fc.property(apiModel.map(rooted), apiModel.map(rooted), success, (before, after, value) => {
        const result = verdict(before, after)
        expect(result.bump).toBe(result.findings.reduce<Bump>((bump, finding) => maxBump(bump, finding.bump), 'none'))
        const more = verdict(before, withExport(after, functionItem(signature([], value))))
        expect(BUMP_ORDER.indexOf(more.bump)).toBeGreaterThanOrEqual(BUMP_ORDER.indexOf(result.bump))
      }),
    )
  })

  it('AE4: a change no rule covers is reported major UNCLASSIFIED_CHANGE, never dropped', () => {
    const partial = { ...defaultCorpus, rules: defaultCorpus.rules.filter((rule) => rule.match.kind !== 'type-changed') }
    fc.assert(
      fc.property(apiModel, success, grown, (surrounding, value, { smaller, larger }) => {
        const before = withExport(surrounding, functionItem(signature([], effect(value, smaller))))
        const after = withExport(surrounding, functionItem(signature([], effect(value, larger))))
        const result = verdict(before, after, partial)
        expect([result.bump, result.findings.map((finding) => finding.reason_code)]).toEqual(['major', ['UNCLASSIFIED_CHANGE']])
      }),
    )
  })

  it('rejects a corpus in which two rules match the same change', () => {
    const [first] = defaultCorpus.rules
    expect(() => decodeRuleCorpus({ ...defaultCorpus, rules: [...defaultCorpus.rules, { ...first, rule_id: 'copy' }] })).toThrow(/two rules match/)
  })
})
