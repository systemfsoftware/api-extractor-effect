import { Schema } from 'effect'

/** Where a type sits relative to the consumer: produced (`out`), consumed (`in`), or both. */
export const Position = Schema.Literals(['in', 'out', 'both'])
export type Position = typeof Position.Type

export const Direction = Schema.Literals(['widened', 'narrowed', 'changed'])
export type Direction = typeof Direction.Type

export const Variance = Schema.Literals(['in', 'out'])
export type Variance = typeof Variance.Type

export const ChangeKind = Schema.Literals([
  'entry-point-added',
  'entry-point-removed',
  'export-added',
  'export-removed',
  'export-kind-changed',
  'overload-added',
  'overload-removed',
  'dual-form-added',
  'dual-form-removed',
  'required-parameter-added',
  'optional-parameter-added',
  'parameter-removed',
  'parameter-became-optional',
  'parameter-became-required',
  'parameter-rest-changed',
  'required-member-added',
  'optional-member-added',
  'member-removed',
  'member-kind-changed',
  'member-became-optional',
  'member-became-required',
  'member-became-readonly',
  'member-became-mutable',
  'type-parameters-changed',
  'heritage-changed',
  'variable-mutability-changed',
  'class-became-abstract',
  'class-became-concrete',
  'enum-member-added',
  'enum-member-removed',
  'enum-member-value-changed',
  'enum-const-changed',
  'type-changed',
])
export type ChangeKind = typeof ChangeKind.Type

/** One difference between two models, before any rule judges it. */
export interface Change {
  readonly kind: ChangeKind
  readonly location: string
  readonly position: Position
  /** The Effect-family channel (`A`, `E`, `R`, ...) the change sits under, if any. */
  readonly channel?: string
  readonly direction?: Direction
}

/** Composes an enclosing position with the variance of a slot inside it. */
export const compose = (position: Position, variance: Variance): Position =>
  position === 'both' ? 'both' : variance === 'out' ? position : position === 'in' ? 'out' : 'in'

/** A function parameter sits in the opposite position to its function. */
export const flip = (position: Position): Position => compose(position, 'in')
