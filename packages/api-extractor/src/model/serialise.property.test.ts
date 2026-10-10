import { describe } from '@systemfsoftware/vitest'
import { canonicalJson } from '../canonical-json.ts'
import { ApiModel, decodeApiModel } from './api-model.ts'
import { sortModel } from './normalise.ts'
import { serialiseApiModel } from './serialise.ts'
import { TypeExpr } from './type-expr.ts'

describe('ApiModel wire document', (it) => {
  it.prop('decodes its own canonical bytes back to the same model', { of: [ApiModel], subject: serialiseApiModel }, (serialise, [model]) => {
    const bytes = serialise(model)
    const decoded = decodeApiModel(JSON.parse(bytes))
    return serialise(decoded) === bytes && canonicalJson(decoded) === canonicalJson(sortModel(model))
  })

  it.prop(
    'serialises the same surface to the same bytes whatever order its exports arrive in',
    { of: [ApiModel], subject: serialiseApiModel },
    (serialise, [model]) => {
      const shuffled = { ...model, entryPoints: [...model.entryPoints].reverse().map((entry) => ({ ...entry, items: [...entry.items].reverse() })) }
      return serialise(shuffled) === serialise(model)
    },
  )

  it.prop(
    'orders a value and a type sharing a name the same way whatever order they arrive in',
    { of: [ApiModel, TypeExpr], subject: serialiseApiModel },
    (serialise, [model, type]) => {
      const pair = [
        { kind: 'variable', name: 'Shared', constant: true, type },
        { kind: 'typeAlias', name: 'Shared', typeParameters: [], type },
      ] as const
      const withItems = (items: ReadonlyArray<(typeof pair)[number]>): ApiModel => ({ ...model, entryPoints: [{ path: '.', items, locals: [] }] })
      return serialise(withItems([...pair].reverse())) === serialise(withItems(pair))
    },
  )
})
