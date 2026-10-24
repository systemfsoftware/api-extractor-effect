import { Array as Arr, Order, Schema } from 'effect'
import { canonicalKey, type Json } from '../canonical-json.schema.ts'

const KEYWORD_NAMES = [
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
] as const

/** TypeScript keyword types the model names directly. */
export const KeywordName: Schema.Literals<typeof KEYWORD_NAMES> = Schema.Literals(KEYWORD_NAMES)
export type KeywordName = typeof KeywordName.Type

export type KeywordType = {
  readonly kind: 'keyword'
  readonly name: KeywordName
}

/** A literal type; `text` is its source spelling (`"a"`, `1`, `true`). */
export type LiteralType = {
  readonly kind: 'literal'
  readonly text: string
}

/** A named type. `module` is set for references into another package. */
export type ReferenceType = {
  readonly kind: 'reference'
  readonly name: string
  readonly module?: string
  readonly args: ReadonlyArray<TypeExpr>
}

export type UnionType = {
  readonly kind: 'union'
  readonly members: ReadonlyArray<TypeExpr>
}

export type IntersectionType = {
  readonly kind: 'intersection'
  readonly members: ReadonlyArray<TypeExpr>
}

export type ArrayType = {
  readonly kind: 'array'
  readonly readonly: boolean
  readonly element: TypeExpr
}

export type TupleType = {
  readonly kind: 'tuple'
  readonly readonly: boolean
  readonly elements: ReadonlyArray<TypeExpr>
}

export type FunctionType = {
  readonly kind: 'function'
  readonly signature: Signature
}

export type ObjectType = {
  readonly kind: 'object'
  readonly members: ReadonlyArray<Member>
}

/** Any type the structural model does not decompose, kept as its source text. */
export type TextType = {
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

const TYPE_PARAMETER_MODIFIERS = ['in', 'out', 'const'] as const

/** A type parameter's variance or const modifier. */
export const TypeParameterModifier: Schema.Literals<typeof TYPE_PARAMETER_MODIFIERS> = Schema.Literals(TYPE_PARAMETER_MODIFIERS)
export type TypeParameterModifier = typeof TypeParameterModifier.Type

export type TypeParameter = {
  readonly name: string
  readonly constraint?: TypeExpr
  readonly default?: TypeExpr
  /** The modifiers written before the name, in source order. */
  readonly modifiers?: ReadonlyArray<TypeParameterModifier>
}

export type Parameter = {
  readonly name: string
  readonly type: TypeExpr
  readonly optional: boolean
  readonly rest: boolean
}

export type Signature = {
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly parameters: ReadonlyArray<Parameter>
  readonly returns: TypeExpr
}

export type PropertyMember = {
  readonly kind: 'property'
  readonly name: string
  readonly optional: boolean
  readonly readonly: boolean
  readonly type: TypeExpr
}

export type MethodMember = {
  readonly kind: 'method'
  readonly name: string
  readonly optional: boolean
  readonly signatures: ReadonlyArray<Signature>
}

/** A call signature of an object type; an Effect dual API is a set of these. */
export type CallMember = {
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
  modifiers: Schema.optionalKey(Schema.Array(TypeParameterModifier)),
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

/** A recursion point too: members hold signatures, which hold types, which hold members. */
export const Member: Schema.Codec<Member> = Schema.suspend((): Schema.Codec<Member> => Schema.Union([
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
])).annotate({ recursionBudget: { maxDepth: 6, depthSize: 'small' } })

/** The recursion point of the type AST; generation stays within the declared budget. */
export const TypeExpr: Schema.Codec<TypeExpr> = Schema.suspend((): Schema.Codec<TypeExpr> => Schema.Union([
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
])).annotate({ recursionBudget: { maxDepth: 4, depthSize: 'small' } })

const never: TypeExpr = { kind: 'keyword', name: 'never' }
const unknown: TypeExpr = { kind: 'keyword', name: 'unknown' }

const byKey = <A extends Json>(values: ReadonlyArray<A>): ReadonlyArray<A> =>
  Array.from(new Map(values.map((value) => [canonicalKey(value), value] as const)))
    .sort(([left], [right]) => Order.String(left, right))
    .map(([, value]) => value)

const flatten = (kind: 'union' | 'intersection', members: ReadonlyArray<TypeExpr>): ReadonlyArray<TypeExpr> =>
  members.flatMap((member) => (member.kind === kind ? member.members : [member]))

/** What an empty set type means: no member admits nothing, no constraint admits anything. */
const EMPTY_SET: Readonly<Record<'union' | 'intersection', TypeExpr>> = { union: never, intersection: unknown }

const setType = (kind: 'union' | 'intersection', members: ReadonlyArray<TypeExpr>): TypeExpr =>
  Arr.match(byKey(flatten(kind, members.map(normaliseType))), {
    onEmpty: () => EMPTY_SET[kind],
    onNonEmpty: (normalised): TypeExpr => (normalised.length === 1 ? Arr.headNonEmpty(normalised) : { kind, members: normalised }),
  })

const constraintOf = (parameter: TypeParameter): Pick<TypeParameter, 'constraint'> =>
  parameter.constraint === undefined ? {} : { constraint: normaliseType(parameter.constraint) }

const defaultOf = (parameter: TypeParameter): Pick<TypeParameter, 'default'> =>
  parameter.default === undefined ? {} : { default: normaliseType(parameter.default) }

const modifierFields = (parameter: TypeParameter): Pick<TypeParameter, 'modifiers'> =>
  parameter.modifiers === undefined ? {} : { modifiers: parameter.modifiers }

const normaliseTypeParameter = (parameter: TypeParameter): TypeParameter => ({
  name: parameter.name,
  ...modifierFields(parameter),
  ...constraintOf(parameter),
  ...defaultOf(parameter),
})

export const normaliseSignature = (signature: Signature): Signature => ({
  typeParameters: signature.typeParameters.map(normaliseTypeParameter),
  parameters: signature.parameters.map((parameter) => ({ ...parameter, type: normaliseType(parameter.type) })),
  returns: normaliseType(signature.returns),
})

const normaliseMember = (member: Member): Member => {
  switch (member.kind) {
    case 'property':
      return { ...member, type: normaliseType(member.type) }
    case 'method':
      return { ...member, signatures: member.signatures.map(normaliseSignature) }
    case 'call':
      return { kind: 'call', signature: normaliseSignature(member.signature) }
  }
}

/**
 * Puts a type in its canonical form: unions and intersections flattened,
 * de-duplicated and ordered by structural key, so `A | B` and `B | A` are one type.
 */
export const normaliseType = (type: TypeExpr): TypeExpr => {
  switch (type.kind) {
    case 'union':
    case 'intersection':
      return setType(type.kind, type.members)
    case 'reference':
      return { ...type, args: type.args.map(normaliseType) }
    case 'array':
      return { ...type, element: normaliseType(type.element) }
    case 'tuple':
      return { ...type, elements: type.elements.map(normaliseType) }
    case 'function':
      return { kind: 'function', signature: normaliseSignature(type.signature) }
    case 'object':
      return { kind: 'object', members: type.members.map(normaliseMember) }
    case 'keyword':
    case 'literal':
    case 'text':
      return type
  }
}

/** The structural identity of a type: equal keys mean the same type. */
export const typeKey = (type: TypeExpr): string => canonicalKey(normaliseType(type))
