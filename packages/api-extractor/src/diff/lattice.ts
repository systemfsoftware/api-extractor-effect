import type { TypeExpr } from '../model/type-expr.ts'
import { typeKey } from '../model/normalise.ts'
import type { Direction } from './change.ts'

const literalKeyword = (text: string): string | undefined => {
  if (text === 'true' || text === 'false') return 'boolean'
  if (/^["'`]/.test(text)) return 'string'
  if (/^-?\d[\d_]*n$/.test(text)) return 'bigint'
  if (/^-?(\d|\.\d)/.test(text)) return 'number'
  return undefined
}

/** `left` is assignable to `right` on the small lattice the verdict decides on. */
const below = (left: TypeExpr, right: TypeExpr): boolean => {
  if (typeKey(left) === typeKey(right)) return true
  if (right.kind === 'keyword' && (right.name === 'unknown' || right.name === 'any')) return true
  if (left.kind === 'keyword' && left.name === 'never') return true
  return left.kind === 'literal' && right.kind === 'keyword' && literalKeyword(left.text) === right.name
}

const membersOf = (type: TypeExpr): ReadonlyArray<TypeExpr> =>
  type.kind === 'union' ? type.members : type.kind === 'keyword' && type.name === 'never' ? [] : [type]

const within = (left: ReadonlyArray<TypeExpr>, right: ReadonlyArray<TypeExpr>): boolean =>
  left.every((member) => right.some((candidate) => below(member, candidate)))

/**
 * How `after` relates to `before`, both normalised: `widened` when it admits
 * more values, `narrowed` when fewer, `changed` otherwise, and `undefined`
 * when the two are equivalent on the lattice.
 */
export const direction = (before: TypeExpr, after: TypeExpr): Direction | undefined => {
  const beforeMembers = membersOf(before)
  const afterMembers = membersOf(after)
  const grew = within(beforeMembers, afterMembers)
  const shrank = within(afterMembers, beforeMembers)
  if (grew && shrank) return undefined
  if (grew) return 'widened'
  if (shrank) return 'narrowed'
  return 'changed'
}
