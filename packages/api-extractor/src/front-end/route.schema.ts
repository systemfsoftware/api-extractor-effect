import { Schema } from 'effect'
import { Diagnostic } from './declarations.schema.ts'

export const FastPath: Schema.TaggedStruct<'FastPath', {}> = Schema.TaggedStruct('FastPath', {})
export type FastPath = typeof FastPath.Type

export const Fallback: Schema.TaggedStruct<'Fallback', { readonly diagnostics: Schema.$Array<typeof Diagnostic> }> = Schema.TaggedStruct('Fallback', {
  diagnostics: Schema.Array(Diagnostic),
})
export type Fallback = typeof Fallback.Type

export const Route: Schema.Union<readonly [typeof FastPath, typeof Fallback]> = Schema.Union([FastPath, Fallback])
export type Route = typeof Route.Type
