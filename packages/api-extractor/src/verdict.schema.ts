import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Schema } from 'effect'
import { ApiModel } from './model/api-model.ts'
import { Bump, RuleCorpus } from './rules/corpus.ts'

/** The verdict document's wire version. */
export const VERDICT_SCHEMA_VERSION = 1

/** One rule that fired, with every location it fired at. */
export const Finding = Schema.Struct({
  rule_id: Schema.String,
  reason_code: Schema.String,
  bump: Bump,
  next_action: Schema.String,
  locations: Schema.Array(Schema.String),
})
export type Finding = typeof Finding.Type

/** The family brand every outcome of the verdict decision carries. */
export const VerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/api-extractor/Verdict')

/** The semver bump two surfaces of one package call for, with the findings behind it. */
export class Verdict extends Schema.TaggedClass<Verdict>()('Verdict', {
  schemaVersion: Schema.Literal(VERDICT_SCHEMA_VERSION),
  engine: Schema.String,
  corpusVersion: Schema.String,
  declarations: Schema.Struct({ before: Schema.String, after: Schema.String }),
  bump: Bump,
  findings: Schema.Array(Finding),
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

/** The corpus a refusal names, and each way its rules fail to pick one rule per change. */
export const CorpusAmbiguities = {
  corpusVersion: Schema.String,
  ambiguities: Schema.Array(Schema.String),
}

/** A corpus whose rules do not pick one rule per change: two rules share a match, or a rule id repeats. */
export class AmbiguousRuleCorpus extends Schema.TaggedError<AmbiguousRuleCorpus>()('AmbiguousRuleCorpus', CorpusAmbiguities) {}

/** Judge the change from one surface of a package to the next against a rule corpus. */
export class CompareSurfaces extends Schema.TaggedClass<CompareSurfaces>()('CompareSurfaces', {
  before: ApiModel,
  after: ApiModel,
  corpus: RuleCorpus,
}) {
  // The surfaces and corpus are documents, not span attributes; the verdict cell's span names the operation.
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
