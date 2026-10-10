import { Function, Match, Schema } from 'effect'
import { canonicalKey } from '../canonical-json.schema.ts'
import type { KeywordName, TypeExpr } from '../model/type-expr.schema.ts'

/** How a type moved: it admits more values, fewer, or neither. */
export const Direction = Schema.Literals(['widened', 'narrowed', 'changed'])
export type Direction = typeof Direction.Type

/** The keyword type each literal spelling belongs to, by the spelling's shape. */
const LITERAL_KEYWORDS: ReadonlyArray<readonly [RegExp, KeywordName]> = [
  [/^(true|false)$/, 'boolean'],
  [/^["'`]/, 'string'],
  [/^-?\d[\d_]*n$/, 'bigint'],
  [/^-?(\d|\.\d)/, 'number'],
]

const literalKeyword = (text: string): KeywordName | undefined => LITERAL_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1]

/** A normalised union member with its structural key, computed once. */
type Keyed = {
  readonly type: TypeExpr
  readonly key: string
}

const isKeyword = (type: TypeExpr, names: ReadonlyArray<KeywordName>): boolean =>
  Match.value(type).pipe(
    Match.when({ kind: 'keyword' }, (keyword) => names.includes(keyword.name)),
    Match.orElse(() => false),
  )

const literalOfKeyword = (left: TypeExpr, right: TypeExpr): boolean =>
  Match.value({ left, right }).pipe(
    Match.when({ left: { kind: 'literal' }, right: { kind: 'keyword' } }, (pair) => literalKeyword(pair.left.text) === pair.right.name),
    Match.orElse(() => false),
  )

/** Each way `left` can be assignable to `right` on the small lattice the verdict decides on. */
const BELOW: ReadonlyArray<(left: Keyed, right: Keyed) => boolean> = [
  (left, right) => left.key === right.key,
  (_left, right) => isKeyword(right.type, ['unknown', 'any']),
  (left) => isKeyword(left.type, ['never']),
  (left, right) => literalOfKeyword(left.type, right.type),
]

const below = (left: Keyed, right: Keyed): boolean => BELOW.some((assignable) => assignable(left, right))

const keyed = (type: TypeExpr): Keyed => ({ type, key: canonicalKey(type) })

const membersOf = (type: TypeExpr): ReadonlyArray<Keyed> =>
  Match.value(type)
    .pipe(
      Match.when({ kind: 'union' }, (union): ReadonlyArray<TypeExpr> => union.members),
      Match.when({ kind: 'keyword', name: 'never' }, (): ReadonlyArray<TypeExpr> => []),
      Match.orElse((other): ReadonlyArray<TypeExpr> => [other]),
    )
    .map(keyed)

const within = (left: ReadonlyArray<Keyed>, right: ReadonlyArray<Keyed>): boolean =>
  left.every((member) => right.some((candidate) => below(member, candidate)))

/** Indexed by whether the type grew and whether it shrank; both means equivalent. */
const DIRECTION_OF: Readonly<Record<`${boolean}|${boolean}`, Direction | undefined>> = {
  'true|true': undefined,
  'true|false': 'widened',
  'false|true': 'narrowed',
  'false|false': 'changed',
}

/**
 * How `after` relates to `before`, both normalised: `widened` when it admits
 * more values, `narrowed` when fewer, `changed` otherwise, and `undefined`
 * when the two are equivalent on the lattice.
 */
export const direction: {
  (after: TypeExpr): (before: TypeExpr) => Direction | undefined
  (before: TypeExpr, after: TypeExpr): Direction | undefined
} = Function.dual(2, (before: TypeExpr, after: TypeExpr): Direction | undefined => {
  const beforeMembers = membersOf(before)
  const afterMembers = membersOf(after)
  return DIRECTION_OF[`${within(beforeMembers, afterMembers)}|${within(afterMembers, beforeMembers)}`]
})
