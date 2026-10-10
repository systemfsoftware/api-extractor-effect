import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/canonical-json.ts'
import { decodeApiModel, encodeApiModel } from '../src/model/api-model.ts'
import { sortModel } from '../src/model/normalise.ts'
import { apiModel } from './__fixtures__/arbitraries.ts'

describe('ApiModel schema', () => {
  it('round-trips every model through its JSON bytes', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        const bytes = canonicalJson(encodeApiModel(model))
        const decoded = decodeApiModel(JSON.parse(bytes))
        expect(decoded).toEqual(model)
        expect(canonicalJson(encodeApiModel(decoded))).toBe(bytes)
      }),
    )
  })

  it('rejects a model of any other schemaVersion', () => {
    fc.assert(
      fc.property(apiModel, fc.integer().filter((version) => version !== 1), (model, version) => {
        expect(() => decodeApiModel({ ...model, schemaVersion: version })).toThrow()
      }),
    )
  })

  it('serialises the same surface to the same bytes whatever order its exports arrive in', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        const shuffled = { ...model, entryPoints: [...model.entryPoints].reverse().map((entry) => ({ ...entry, items: [...entry.items].reverse() })) }
        expect(canonicalJson(sortModel(shuffled))).toBe(canonicalJson(sortModel(model)))
      }),
    )
  })
})
