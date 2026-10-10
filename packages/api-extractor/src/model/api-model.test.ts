import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { API_MODEL_SCHEMA_VERSION, decodeApiModel } from './api-model.ts'
import { sortModel } from './normalise.ts'
import { serialiseApiModel } from './serialise.ts'
import { apiModel, typeExpr } from '../../tests/__fixtures__/arbitraries.ts'

describe('ApiModel wire document', () => {
  it('decodes its own canonical bytes back to the same model', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        const bytes = serialiseApiModel(model)
        expect(serialiseApiModel(decodeApiModel(JSON.parse(bytes)))).toBe(bytes)
        expect(decodeApiModel(JSON.parse(bytes))).toEqual(sortModel(model))
      }),
    )
  })

  it('rejects a model of any other schemaVersion', () => {
    fc.assert(
      fc.property(apiModel, fc.integer().filter((version) => version !== API_MODEL_SCHEMA_VERSION), (model, version) => {
        expect(() => decodeApiModel({ ...model, schemaVersion: version })).toThrow()
      }),
    )
  })

  it('serialises the same surface to the same bytes whatever order its exports arrive in', () => {
    fc.assert(
      fc.property(apiModel, (model) => {
        const shuffled = { ...model, entryPoints: [...model.entryPoints].reverse().map((entry) => ({ ...entry, items: [...entry.items].reverse() })) }
        expect(serialiseApiModel(shuffled)).toBe(serialiseApiModel(model))
      }),
    )
  })

  it('orders a value and a type sharing a name the same way whatever order they arrive in', () => {
    fc.assert(
      fc.property(apiModel, typeExpr, (model, type) => {
        const pair = [
          { kind: 'variable', name: 'Shared', constant: true, type },
          { kind: 'typeAlias', name: 'Shared', typeParameters: [], type },
        ] as const
        const withItems = (items: ReadonlyArray<(typeof pair)[number]>) => ({ ...model, entryPoints: [{ path: '.', items, locals: [] }] })
        expect(serialiseApiModel(withItems([...pair].reverse()))).toBe(serialiseApiModel(withItems(pair)))
      }),
    )
  })
})
