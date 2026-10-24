import { Effect } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { ApiModel } from '../model/api-model.schema.ts'
import type { AnalysisMessage } from './analysis-message.schema.ts'
import { modelOfGraph } from './build-model.ts'
import { CompilerEmitter, type CompilerEmitterId, IsolatedEmitter, type IsolatedEmitterId } from './declaration-emitter.service.ts'
import { declarationGraph } from './declaration-graph.ts'
import type { Declarations, PackageSource } from './declarations.schema.ts'
import type { CompilerRejected, NotIsolated, UnsupportedDeclaration } from './front-end-error.schema.ts'
import { messagesOfGraph } from './resolve-messages.ts'
import type { Route } from './route.schema.ts'

export type Analysis = {
  readonly route: Route
  readonly model: ApiModel
  readonly messages: ReadonlyArray<AnalysisMessage>
}

type Routed = { readonly route: Route; readonly declarations: Declarations }

const compiled = (source: PackageSource, refusal: NotIsolated): Effect.Effect<Routed, CompilerRejected | PlatformError | UnsupportedDeclaration, CompilerEmitterId> =>
  Effect.gen(function* () {
    const compiler = yield* CompilerEmitter
    const declarations = yield* compiler.emit(source)
    const routed: Routed = { route: { _tag: 'Fallback', diagnostics: refusal.diagnostics }, declarations }
    return routed
  })

const routed = (source: PackageSource): Effect.Effect<Routed, CompilerRejected | PlatformError | UnsupportedDeclaration, IsolatedEmitterId | CompilerEmitterId> =>
  Effect.gen(function* () {
    const isolated = yield* IsolatedEmitter
    return yield* isolated.emit(source).pipe(
      Effect.map((declarations): Routed => ({ route: { _tag: 'FastPath' }, declarations })),
      Effect.catchTag('NotIsolated', (refusal) => compiled(source, refusal)),
    )
  })

export const analyse = (
  source: PackageSource,
): Effect.Effect<Analysis, CompilerRejected | PlatformError | UnsupportedDeclaration, IsolatedEmitterId | CompilerEmitterId> =>
  Effect.gen(function* () {
    const { route, declarations } = yield* routed(source)
    const graph = yield* declarationGraph(declarations)
    const analysis: Analysis = {
      route,
      model: yield* modelOfGraph({ graph, producer: declarations.producer, package: declarations.package }),
      messages: yield* messagesOfGraph(graph),
    }
    return analysis
  })
