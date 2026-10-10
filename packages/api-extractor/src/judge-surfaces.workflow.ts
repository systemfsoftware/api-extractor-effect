import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Array as Arr, Result } from 'effect'
import { diffModels } from './diff/diff.ts'
import { ambiguitiesOf, bumpOf, findingsOf } from './findings.ts'
import { ENGINE } from './version.ts'
import { AmbiguousRuleCorpus, CompareSurfaces, Verdict, VERDICT_SCHEMA_VERSION } from './verdict.schema.ts'

/**
 * The verdict decision: every change between two surfaces, classified by the
 * corpus, and the highest bump among them. A corpus that cannot pick one rule
 * per change is refused before anything is judged.
 */
export const judgeSurfaces = Workflow.make({
  command: CompareSurfaces,
  decision: Verdict,
  error: AmbiguousRuleCorpus,
  decide: ({ before, after, corpus }) =>
    Arr.match(ambiguitiesOf(corpus), {
      onEmpty: () => {
        const findings = findingsOf(corpus, diffModels(before, after, corpus.channelTypes))
        return Result.succeed(
          new Verdict({
            schemaVersion: VERDICT_SCHEMA_VERSION,
            engine: ENGINE,
            corpusVersion: corpus.corpusVersion,
            declarations: { before: before.producer.declarations, after: after.producer.declarations },
            bump: bumpOf(findings),
            findings,
          }),
        )
      },
      onNonEmpty: (ambiguities) => Result.fail(new AmbiguousRuleCorpus({ corpusVersion: corpus.corpusVersion, ambiguities })),
    }),
})
