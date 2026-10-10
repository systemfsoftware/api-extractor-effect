import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect } from 'effect'
import { canonicalJson } from './canonical-json.schema.ts'
import { judgeSurfaces } from './judge-surfaces.workflow.ts'
import type { ApiModel } from './model/api-model.schema.ts'
import type { RuleCorpus } from './rules/corpus.schema.ts'
import { defaultCorpus } from './rules/default-corpus.ts'
import { RuleCorpusRejected, SurfaceRejected } from './verdict.schema.ts'
import { ENGINE } from './version.ts'

/** Two encoded surfaces of one package, and the corpus to judge them by (the shipped one when absent). */
export type VerdictInput = {
  readonly before: ApiModel
  readonly after: ApiModel
  readonly corpus?: RuleCorpus
}

/**
 * Judges two surfaces and answers the verdict document as canonical JSON bytes,
 * stamped with this engine. Both surfaces and the corpus are decoded before the
 * decision sees them.
 */
export const verdictCell = Sandwich.named('api_extractor.verdict')((input: VerdictInput) =>
  // The encoded command, not `new CompareSurfaces(...)`: the constructor validates and would throw
  // on an undecodable surface, where the cell must answer `SurfaceRejected`.
  Effect.succeed({
    _tag: 'CompareSurfaces' as const,
    engine: ENGINE,
    before: input.before,
    after: input.after,
    corpus: input.corpus ?? defaultCorpus,
  })
)
  .decide(judgeSurfaces)
  .write({
    Verdict: (verdict) => Effect.succeed(canonicalJson(verdict)),
    AmbiguousRuleCorpus: ({ corpusVersion, ambiguities }) => Effect.fail(new RuleCorpusRejected({ corpusVersion, ambiguities })),
    CommandRejected: ({ issue }) => Effect.fail(new SurfaceRejected({ issue })),
  })
