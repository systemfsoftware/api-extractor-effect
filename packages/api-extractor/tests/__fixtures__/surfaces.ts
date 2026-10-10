import type { ApiItem, ApiModel, EntryPoint, TypeAliasItem } from '../../src/model/api-model.ts'
import type { Parameter, Signature, TypeExpr } from '../../src/model/type-expr.ts'

export const ref = (name: string, ...args: ReadonlyArray<TypeExpr>): TypeExpr => ({ kind: 'reference', name, args })
export const never: TypeExpr = { kind: 'keyword', name: 'never' }
export const voidType: TypeExpr = { kind: 'keyword', name: 'void' }
export const union = (members: ReadonlyArray<TypeExpr>): TypeExpr =>
  members.length === 1 ? (members[0] as TypeExpr) : { kind: 'union', members }
export const effect = (success: TypeExpr, failure: TypeExpr, requirements: TypeExpr = never): TypeExpr =>
  ref('Effect', success, failure, requirements)

export const parameter = (name: string, type: TypeExpr, optional = false): Parameter => ({ name, type, optional, rest: false })
export const signature = (parameters: ReadonlyArray<Parameter>, returns: TypeExpr): Signature => ({
  typeParameters: [],
  parameters,
  returns,
})
export const fn = (sig: Signature): TypeExpr => ({ kind: 'function', signature: sig })

export const TARGET = 'target'

export const functionItem = (...signatures: ReadonlyArray<Signature>): ApiItem => ({ kind: 'function', name: TARGET, signatures })

/** The model with `item` exported from `.` (and `locals` added there), keeping everything else. */
export const withExport = (model: ApiModel, item: ApiItem, locals: ReadonlyArray<TypeAliasItem> = []): ApiModel => {
  const root = model.entryPoints.find((entry) => entry.path === '.')
  const others = model.entryPoints.filter((entry) => entry.path !== '.')
  const entry: EntryPoint = {
    path: '.',
    items: [...(root?.items ?? []).filter((existing) => existing.name !== item.name), item],
    locals: [...(root?.locals ?? []).filter((alias) => !locals.some((local) => local.name === alias.name)), ...locals],
  }
  return { ...model, entryPoints: [...others, entry] }
}

export const alias = (name: string, type: TypeExpr): TypeAliasItem => ({ kind: 'typeAlias', name, typeParameters: [], type })

/** The model with a `.` entry point and no export named `target`. */
export const rooted = (model: ApiModel): ApiModel => {
  const entries = model.entryPoints.map((entry) => ({ ...entry, items: entry.items.filter((item) => item.name !== TARGET) }))
  return { ...model, entryPoints: entries.some((entry) => entry.path === '.') ? entries : [...entries, { path: '.', items: [], locals: [] }] }
}

export const rootedWith = (model: ApiModel, items: ReadonlyArray<ApiItem>, locals: ReadonlyArray<TypeAliasItem> = []): ApiModel => ({
  ...model,
  entryPoints: [...model.entryPoints.filter((entry) => entry.path !== '.'), { path: '.', items, locals }],
})
