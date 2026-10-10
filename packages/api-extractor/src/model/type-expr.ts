import { Schema } from 'effect'

/** TypeScript keyword types the model names directly. */
export const KeywordName = Schema.Literals([
  'any',
  'bigint',
  'boolean',
  'never',
  'null',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
  'void',
])
export type KeywordName = typeof KeywordName.Type

export interface KeywordType {
  readonly kind: 'keyword'
  readonly name: KeywordName
}

/** A literal type; `text` is its source spelling (`"a"`, `1`, `true`). */
export interface LiteralType {
  readonly kind: 'literal'
  readonly text: string
}

/** A named type. `module` is set for references into another package. */
export interface ReferenceType {
  readonly kind: 'reference'
  readonly name: string
  readonly module?: string
  readonly args: ReadonlyArray<TypeExpr>
}

export interface UnionType {
  readonly kind: 'union'
  readonly members: ReadonlyArray<TypeExpr>
}

export interface IntersectionType {
  readonly kind: 'intersection'
  readonly members: ReadonlyArray<TypeExpr>
}

export interface ArrayType {
  readonly kind: 'array'
  readonly readonly: boolean
  readonly element: TypeExpr
}

export interface TupleType {
  readonly kind: 'tuple'
  readonly readonly: boolean
  readonly elements: ReadonlyArray<TypeExpr>
}

export interface FunctionType {
  readonly kind: 'function'
  readonly signature: Signature
}

export interface ObjectType {
  readonly kind: 'object'
  readonly members: ReadonlyArray<Member>
}

/** Any type the structural model does not decompose, kept as its source text. */
export interface TextType {
  readonly kind: 'text'
  readonly text: string
}

export type TypeExpr =
  | KeywordType
  | LiteralType
  | ReferenceType
  | UnionType
  | IntersectionType
  | ArrayType
  | TupleType
  | FunctionType
  | ObjectType
  | TextType

export interface TypeParameter {
  readonly name: string
  readonly constraint?: TypeExpr
  readonly default?: TypeExpr
}

export interface Parameter {
  readonly name: string
  readonly type: TypeExpr
  readonly optional: boolean
  readonly rest: boolean
}

export interface Signature {
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly parameters: ReadonlyArray<Parameter>
  readonly returns: TypeExpr
}

export interface PropertyMember {
  readonly kind: 'property'
  readonly name: string
  readonly optional: boolean
  readonly readonly: boolean
  readonly type: TypeExpr
}

export interface MethodMember {
  readonly kind: 'method'
  readonly name: string
  readonly optional: boolean
  readonly signatures: ReadonlyArray<Signature>
}

/** A call signature of an object type; an Effect dual API is a set of these. */
export interface CallMember {
  readonly kind: 'call'
  readonly signature: Signature
}

export type Member = PropertyMember | MethodMember | CallMember

const typeExpr = Schema.suspend((): Schema.Codec<TypeExpr> => TypeExpr)
const signature = Schema.suspend((): Schema.Codec<Signature> => Signature)

export const TypeParameter: Schema.Codec<TypeParameter> = Schema.Struct({
  name: Schema.String,
  constraint: Schema.optionalKey(typeExpr),
  default: Schema.optionalKey(typeExpr),
})

export const Parameter: Schema.Codec<Parameter> = Schema.Struct({
  name: Schema.String,
  type: typeExpr,
  optional: Schema.Boolean,
  rest: Schema.Boolean,
})

export const Signature: Schema.Codec<Signature> = Schema.Struct({
  typeParameters: Schema.Array(TypeParameter),
  parameters: Schema.Array(Parameter),
  returns: typeExpr,
})

export const Member: Schema.Codec<Member> = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('property'),
    name: Schema.String,
    optional: Schema.Boolean,
    readonly: Schema.Boolean,
    type: typeExpr,
  }),
  Schema.Struct({
    kind: Schema.Literal('method'),
    name: Schema.String,
    optional: Schema.Boolean,
    signatures: Schema.Array(signature),
  }),
  Schema.Struct({ kind: Schema.Literal('call'), signature }),
])

export const TypeExpr: Schema.Codec<TypeExpr> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('keyword'), name: KeywordName }),
  Schema.Struct({ kind: Schema.Literal('literal'), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('reference'),
    name: Schema.String,
    module: Schema.optionalKey(Schema.String),
    args: Schema.Array(typeExpr),
  }),
  Schema.Struct({ kind: Schema.Literal('union'), members: Schema.Array(typeExpr) }),
  Schema.Struct({ kind: Schema.Literal('intersection'), members: Schema.Array(typeExpr) }),
  Schema.Struct({ kind: Schema.Literal('array'), readonly: Schema.Boolean, element: typeExpr }),
  Schema.Struct({ kind: Schema.Literal('tuple'), readonly: Schema.Boolean, elements: Schema.Array(typeExpr) }),
  Schema.Struct({ kind: Schema.Literal('function'), signature }),
  Schema.Struct({ kind: Schema.Literal('object'), members: Schema.Array(Member) }),
  Schema.Struct({ kind: Schema.Literal('text'), text: Schema.String }),
])
