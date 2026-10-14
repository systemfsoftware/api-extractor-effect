import { Function, Schema } from 'effect'
import { TypeExpr } from '../model/type-expr.schema.ts'

/** Where a type sits relative to the consumer: produced (`out`), consumed (`in`), or both. */
export const Position: Schema.Literals<readonly ['in', 'out', 'both']> = Schema.Literals(['in', 'out', 'both'])
export type Position = typeof Position.Type

export const Variance: Schema.Literals<readonly ['in', 'out']> = Schema.Literals(['in', 'out'])
export type Variance = typeof Variance.Type

/** A generic type whose type arguments are Effect-style channels with a declared variance. */
export type ChannelType = {
  /** Spellings the declarations use for the type, e.g. `Effect` and `Effect.Effect`. */
  readonly names: ReadonlyArray<string>
  /** Packages the type comes from; a reference with no module matches any of them. */
  readonly modules: ReadonlyArray<string>
  /**
   * The type arguments in declaration order. A trailing channel with a `default`
   * may be left out of a reference, as `Effect<A, E>` leaves out `R = never`.
   */
  readonly channels: ReadonlyArray<{ readonly name: string; readonly variance: Variance; readonly default?: TypeExpr }>
}

export const ChannelType: Schema.Codec<ChannelType> = Schema.Struct({
  names: Schema.Array(Schema.String),
  modules: Schema.Array(Schema.String),
  channels: Schema.Array(Schema.Struct({ name: Schema.String, variance: Variance, default: Schema.optionalKey(TypeExpr) })),
})

/** An `out` slot keeps the enclosing position, an `in` slot flips it, and `both` stays `both`. */
const COMPOSED: Readonly<Record<Position, Readonly<Record<Variance, Position>>>> = {
  in: { in: 'out', out: 'in' },
  out: { in: 'in', out: 'out' },
  both: { in: 'both', out: 'both' },
}

/** Composes an enclosing position with the variance of a slot inside it. */
export const compose: {
  (variance: Variance): (position: Position) => Position
  (position: Position, variance: Variance): Position
} = Function.dual(2, (position: Position, variance: Variance): Position => COMPOSED[position][variance])

/** A function parameter sits in the opposite position to its function. */
export const flip = (position: Position): Position => compose(position, 'in')
