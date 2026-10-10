import { canonicalKey, compareCodeUnits } from '../canonical-json.ts'
import type { ApiItem, ApiModel, EntryPoint, TypeAliasItem } from './api-model.ts'
import type { Member, Signature, TypeExpr, TypeParameter } from './type-expr.ts'

const never: TypeExpr = { kind: 'keyword', name: 'never' }
const unknown: TypeExpr = { kind: 'keyword', name: 'unknown' }

const byKey = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => {
  const keyed = values.map((value) => [canonicalKey(value), value] as const)
  const unique = new Map(keyed)
  return [...unique.keys()].sort(compareCodeUnits).map((key) => unique.get(key) as A)
}

const flatten = (kind: 'union' | 'intersection', members: ReadonlyArray<TypeExpr>): ReadonlyArray<TypeExpr> =>
  members.flatMap((member) => (member.kind === kind ? member.members : [member]))

const setType = (kind: 'union' | 'intersection', members: ReadonlyArray<TypeExpr>): TypeExpr => {
  const normalised = byKey(flatten(kind, members.map(normaliseType)))
  if (normalised.length === 1) return normalised[0] as TypeExpr
  if (normalised.length === 0) return kind === 'union' ? never : unknown
  return { kind, members: normalised }
}

const normaliseTypeParameter = (parameter: TypeParameter): TypeParameter => ({
  name: parameter.name,
  ...(parameter.constraint === undefined ? {} : { constraint: normaliseType(parameter.constraint) }),
  ...(parameter.default === undefined ? {} : { default: normaliseType(parameter.default) }),
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

/** By name; items sharing a name (a value beside a type) by kind, then by content, so input order never shows. */
const byName = <A extends { readonly name: string; readonly kind: string }>(values: ReadonlyArray<A>): ReadonlyArray<A> =>
  [...values].sort(
    (left, right) =>
      compareCodeUnits(left.name, right.name) || compareCodeUnits(left.kind, right.kind) || compareCodeUnits(canonicalKey(left), canonicalKey(right)),
  )

const sortItem = (item: ApiItem): ApiItem =>
  item.kind === 'namespace' ? { ...item, items: byName(item.items.map(sortItem)) } : item

const sortEntryPoint = (entryPoint: EntryPoint): EntryPoint => ({
  path: entryPoint.path,
  items: byName(entryPoint.items.map(sortItem)),
  locals: byName<TypeAliasItem>(entryPoint.locals),
})

/** Orders entry points, exports and locals by code unit, so equal surfaces serialise to equal bytes. */
export const sortModel = (model: ApiModel): ApiModel => ({
  ...model,
  entryPoints: [...model.entryPoints.map(sortEntryPoint)].sort((left, right) => compareCodeUnits(left.path, right.path)),
})
