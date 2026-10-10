import { Schema } from 'effect'
import { Member, Signature, TypeExpr, TypeParameter } from './type-expr.ts'

/** The model's wire version. Any change to the model schema bumps it. */
export const API_MODEL_SCHEMA_VERSION = 2

export interface FunctionItem {
  readonly kind: 'function'
  readonly name: string
  readonly signatures: ReadonlyArray<Signature>
}

export interface VariableItem {
  readonly kind: 'variable'
  readonly name: string
  readonly constant: boolean
  readonly type: TypeExpr
}

export interface TypeAliasItem {
  readonly kind: 'typeAlias'
  readonly name: string
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly type: TypeExpr
}

export interface InterfaceItem {
  readonly kind: 'interface'
  readonly name: string
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly extends: ReadonlyArray<TypeExpr>
  readonly members: ReadonlyArray<Member>
}

export interface ClassItem {
  readonly kind: 'class'
  readonly name: string
  readonly abstract: boolean
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly extends: ReadonlyArray<TypeExpr>
  readonly implements: ReadonlyArray<TypeExpr>
  readonly members: ReadonlyArray<Member>
}

export interface EnumMember {
  readonly name: string
  readonly value?: string
}

export interface EnumItem {
  readonly kind: 'enum'
  readonly name: string
  readonly const: boolean
  readonly members: ReadonlyArray<EnumMember>
}

export interface NamespaceItem {
  readonly kind: 'namespace'
  readonly name: string
  readonly items: ReadonlyArray<ApiItem>
}

export type ApiItem =
  | FunctionItem
  | VariableItem
  | TypeAliasItem
  | InterfaceItem
  | ClassItem
  | EnumItem
  | NamespaceItem

export interface EntryPoint {
  /** The package export path, e.g. `.` or `./schema`. */
  readonly path: string
  readonly items: ReadonlyArray<ApiItem>
  /** Type aliases the entry point uses but does not export. */
  readonly locals: ReadonlyArray<TypeAliasItem>
}

export interface Producer {
  /** The engine name and version that built the model. */
  readonly engine: string
  /** The compiler or emitter that produced the declarations the model was built from. */
  readonly declarations: string
}

export interface ApiModel {
  readonly schemaVersion: typeof API_MODEL_SCHEMA_VERSION
  readonly producer: Producer
  readonly package: { readonly name: string; readonly version: string }
  readonly entryPoints: ReadonlyArray<EntryPoint>
}

const uniqueBy = <A>(what: string, key: (value: A) => string) =>
  Schema.makeFilter((values: ReadonlyArray<A>) => new Set(values.map(key)).size === values.length, {
    expected: `${what} unique by key`,
    arbitraryConstraint: { uniqueBy: key },
  })

const typeParameters = Schema.Array(TypeParameter)

export const TypeAliasItem: Schema.Codec<TypeAliasItem> = Schema.Struct({
  kind: Schema.Literal('typeAlias'),
  name: Schema.String,
  typeParameters,
  type: TypeExpr,
})

const apiItem = Schema.suspend((): Schema.Codec<ApiItem> => ApiItem)

/** The recursion point of the item tree (namespaces nest items); generation stays within the declared budget. */
export const ApiItem: Schema.Codec<ApiItem> = Schema.suspend((): Schema.Codec<ApiItem> => Schema.Union([
  Schema.Struct({ kind: Schema.Literal('function'), name: Schema.String, signatures: Schema.Array(Signature) }),
  Schema.Struct({ kind: Schema.Literal('variable'), name: Schema.String, constant: Schema.Boolean, type: TypeExpr }),
  TypeAliasItem,
  Schema.Struct({
    kind: Schema.Literal('interface'),
    name: Schema.String,
    typeParameters,
    extends: Schema.Array(TypeExpr),
    members: Schema.Array(Member),
  }),
  Schema.Struct({
    kind: Schema.Literal('class'),
    name: Schema.String,
    abstract: Schema.Boolean,
    typeParameters,
    extends: Schema.Array(TypeExpr),
    implements: Schema.Array(TypeExpr),
    members: Schema.Array(Member),
  }),
  Schema.Struct({
    kind: Schema.Literal('enum'),
    name: Schema.String,
    const: Schema.Boolean,
    members: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.optionalKey(Schema.String) })).check(
      uniqueBy('enum members', (member: { readonly name: string }) => member.name),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal('namespace'), name: Schema.String, items: Schema.Array(apiItem) }),
])).annotate({ recursionBudget: { maxDepth: 8, depthSize: 'small' } })

export const ApiModel: Schema.Codec<ApiModel> = Schema.Struct({
  schemaVersion: Schema.Literal(API_MODEL_SCHEMA_VERSION),
  producer: Schema.Struct({ engine: Schema.String, declarations: Schema.String }),
  package: Schema.Struct({ name: Schema.String, version: Schema.String }),
  entryPoints: Schema.Array(
    Schema.Struct({ path: Schema.String, items: Schema.Array(ApiItem), locals: Schema.Array(TypeAliasItem) }),
  ).check(uniqueBy('entry points', (entry: { readonly path: string }) => entry.path)),
})

/** Decodes an unknown value (e.g. parsed JSON) into a model; rejects any other `schemaVersion`. */
export const decodeApiModel: (input: unknown) => ApiModel = Schema.decodeUnknownSync(ApiModel)

export const encodeApiModel: (model: ApiModel) => unknown = Schema.encodeSync(ApiModel)
