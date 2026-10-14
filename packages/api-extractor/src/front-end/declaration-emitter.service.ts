import { Context, type Effect } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { Declarations, PackageSource } from './declarations.schema.ts'
import type { CompilerRejected, NotIsolated, UnsupportedDeclaration } from './front-end-error.schema.ts'

export type DeclarationEmitter<E> = {
  readonly emit: (source: PackageSource) => Effect.Effect<Declarations, E | PlatformError | UnsupportedDeclaration>
}

export interface IsolatedEmitterId {
  readonly _: unique symbol
}

export interface CompilerEmitterId {
  readonly _: unique symbol
}

export const IsolatedEmitter: Context.Service<IsolatedEmitterId, DeclarationEmitter<NotIsolated>> = Context.Service<IsolatedEmitterId, DeclarationEmitter<NotIsolated>>(
  '@systemfsoftware/api-extractor/IsolatedEmitter',
)

export const CompilerEmitter: Context.Service<CompilerEmitterId, DeclarationEmitter<CompilerRejected>> = Context.Service<CompilerEmitterId, DeclarationEmitter<CompilerRejected>>(
  '@systemfsoftware/api-extractor/CompilerEmitter',
)
