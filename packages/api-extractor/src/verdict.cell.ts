import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Schema } from 'effect'
import { canonicalJson } from './canonical-json.ts'
import { judgeSurfaces } from './judge-surfaces.workflow.ts'
import type { ApiModel } from './model/api-model.ts'
import { defaultCorpus, type RuleCorpus } from './rules/corpus.ts'

/** A surface or corpus that does not decode against its schema. */
export class SurfaceRejected extends Schema.TaggedError<SurfaceRejected>()('SurfaceRejected', {
  issue: Schema.String,
}) {}

/** A corpus whose rules cannot pick one rule per change. */
export class RuleCorpusRejected extends Schema.TaggedError<RuleCorpusRejected>()('RuleCorpusRejected', {
  corpusVersion: Schema.String,
  ambiguities: Schema.Array(Schema.String),
}) {}

/** Two encoded surfaces of one package, and the corpus to judge them by (the shipped one when absent). */
export interface VerdictInput {
  readonly before: ApiModel
  readonly after: ApiModel
  readonly corpus?: RuleCorpus
}

/**
 * Judges two surfaces and answers the verdict document as canonical JSON bytes.
 * Both surfaces and the corpus are decoded before the decision sees them.
 */
export const verdictCell = Sandwich.named('api_extractor.verdict')((input: VerdictInput) =>
  Effect.succeed({ _tag: 'CompareSurfaces' as const, before: input.before, after: input.after, corpus: input.corpus ?? defaultCorpus })
)
  .decide(judgeSurfaces)
  .write({
    Verdict: (verdict) => Effect.succeed(canonicalJson(verdict)),
    AmbiguousRuleCorpus: ({ corpusVersion, ambiguities }) => Effect.fail(new RuleCorpusRejected({ corpusVersion, ambiguities })),
    CommandRejected: ({ issue }) => Effect.fail(new SurfaceRejected({ issue })),
  })
