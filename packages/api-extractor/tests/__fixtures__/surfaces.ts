import type { ApiModel } from '@systemfsoftware/api-extractor'
import { Function } from 'effect'

type TypeExpr = ApiModel.TypeExpr
type Parameter = ApiModel.Parameter
type Signature = ApiModel.Signature
type ApiItem = ApiModel.ApiItem
type EntryPoint = ApiModel.EntryPoint
type TypeAliasItem = ApiModel.TypeAliasItem
type Model = ApiModel.ApiModel

export const ref = (name: string, ...args: ReadonlyArray<TypeExpr>): TypeExpr => ({ kind: 'reference', name, args })
export const never: TypeExpr = { kind: 'keyword', name: 'never' }
export const voidType: TypeExpr = { kind: 'keyword', name: 'void' }
export const union = (members: ReadonlyArray<TypeExpr>): TypeExpr =>
  members.length === 1 ? members[0] ?? { kind: 'union', members } : { kind: 'union', members }

export const effect: {
  (success: TypeExpr, failure: TypeExpr, requirements?: TypeExpr): TypeExpr
  (failure: TypeExpr, requirements?: TypeExpr): (success: TypeExpr) => TypeExpr
} = Function.dual(
  (args) => args.length >= 2,
  (success: TypeExpr, failure: TypeExpr, requirements: TypeExpr = never): TypeExpr => ref('Effect', success, failure, requirements),
)

export const parameter: {
  (name: string, type: TypeExpr, optional?: boolean): Parameter
  (type: TypeExpr, optional?: boolean): (name: string) => Parameter
} = Function.dual(
  (args) => args.length >= 2,
  (name: string, type: TypeExpr, optional = false): Parameter => ({ name, type, optional, rest: false }),
)

export const signature: {
  (returns: TypeExpr): (parameters: ReadonlyArray<Parameter>) => Signature
  (parameters: ReadonlyArray<Parameter>, returns: TypeExpr): Signature
} = Function.dual(
  2,
  (parameters: ReadonlyArray<Parameter>, returns: TypeExpr): Signature => ({ typeParameters: [], parameters, returns }),
)

export const fn = (sig: Signature): TypeExpr => ({ kind: 'function', signature: sig })

export const TARGET = 'target'

export const functionItem = (...signatures: ReadonlyArray<Signature>): ApiItem => ({ kind: 'function', name: TARGET, signatures })

const rebuilt = (model: Model, entryPoints: ReadonlyArray<EntryPoint>): Model => ({
  schemaVersion: model.schemaVersion,
  producer: model.producer,
  package: model.package,
  entryPoints,
})

/** The model with `item` exported from `.` (and `locals` added there), keeping everything else. */
export const withExport: {
  (model: Model, item: ApiItem, locals?: ReadonlyArray<TypeAliasItem>): Model
  (item: ApiItem, locals?: ReadonlyArray<TypeAliasItem>): (model: Model) => Model
} = Function.dual(
  (args) => args.length >= 2,
  (model: Model, item: ApiItem, locals: ReadonlyArray<TypeAliasItem> = []): Model => {
    const root = model.entryPoints.find((entry) => entry.path === '.')
    const others = model.entryPoints.filter((entry) => entry.path !== '.')
    const entry: EntryPoint = {
      path: '.',
      items: [...(root?.items ?? []).filter((existing) => existing.name !== item.name), item],
      locals: [...(root?.locals ?? []).filter((alias) => !locals.some((local) => local.name === alias.name)), ...locals],
    }
    return rebuilt(model, [...others, entry])
  },
)

export const alias: {
  (type: TypeExpr): (name: string) => TypeAliasItem
  (name: string, type: TypeExpr): TypeAliasItem
} = Function.dual(2, (name: string, type: TypeExpr): TypeAliasItem => ({ kind: 'typeAlias', name, typeParameters: [], type }))

export const rooted = (model: Model): Model => {
  const entries = model.entryPoints.map(
    (entry): EntryPoint => ({ path: entry.path, items: entry.items.filter((item) => item.name !== TARGET), locals: entry.locals }),
  )
  return rebuilt(model, entries.some((entry) => entry.path === '.') ? entries : [...entries, { path: '.', items: [], locals: [] }])
}

export const rootedWith: {
  (model: Model, items: ReadonlyArray<ApiItem>, locals?: ReadonlyArray<TypeAliasItem>): Model
  (items: ReadonlyArray<ApiItem>, locals?: ReadonlyArray<TypeAliasItem>): (model: Model) => Model
} = Function.dual(
  (args) => args.length >= 2,
  (model: Model, items: ReadonlyArray<ApiItem>, locals: ReadonlyArray<TypeAliasItem> = []): Model =>
    rebuilt(model, [...model.entryPoints.filter((entry) => entry.path !== '.'), { path: '.', items, locals }]),
)
