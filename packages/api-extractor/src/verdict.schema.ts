import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Schema } from 'effect'
import { ApiModel } from './model/api-model.schema.ts'
import { Bump, RuleCorpus } from './rules/corpus.schema.ts'
import { Findings } from './rules/finding.schema.ts'

/** The verdict document's wire version. */
export const VerdictVersion = Schema.Literal(1)
export type VerdictVersion = typeof VerdictVersion.Type

export const VERDICT_SCHEMA_VERSION: VerdictVersion = 1

/** The family brand every outcome of the verdict decision carries. */
export const VerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/api-extractor/Verdict')

/** The semver bump two surfaces of one package call for, with the findings behind it. */
export class Verdict extends Schema.TaggedClass<Verdict>()('Verdict', {
  schemaVersion: VerdictVersion,
  engine: Schema.String,
  corpusVersion: Schema.String,
  declarations: Schema.Struct({ before: Schema.String, after: Schema.String }),
  bump: Bump,
  findings: Findings,
}) {
  readonly [VerdictTypeId] = VerdictTypeId
}

/** The corpus a refusal names, and each way its rules fail to pick one rule per change. */
export const CorpusAmbiguities = {
  corpusVersion: Schema.String,
  ambiguities: Schema.Array(Schema.String),
}

const ambiguityMessage = ({ corpusVersion, ambiguities }: { readonly corpusVersion: string; readonly ambiguities: ReadonlyArray<string> }): string =>
  `rule corpus ${corpusVersion} cannot pick one rule per change: ${ambiguities.join('; ')}`

/** A corpus whose rules do not pick one rule per change: two rules share a match, or a rule id repeats. */
export class AmbiguousRuleCorpus extends Schema.TaggedError<AmbiguousRuleCorpus>()('AmbiguousRuleCorpus', CorpusAmbiguities) {
  override get message(): string {
    return ambiguityMessage(this)
  }
}

/** A surface or corpus that does not decode against its schema. */
export class SurfaceRejected extends Schema.TaggedError<SurfaceRejected>()('SurfaceRejected', {
  issue: Schema.String,
}) {
  override get message(): string {
    return `a surface or the corpus does not decode: ${this.issue}`
  }
}

/** A corpus whose rules cannot pick one rule per change, refused by the verdict cell. */
export class RuleCorpusRejected extends Schema.TaggedError<RuleCorpusRejected>()('RuleCorpusRejected', CorpusAmbiguities) {
  override get message(): string {
    return ambiguityMessage(this)
  }
}

/**
 * Judge the change from one surface of a package to the next against a rule
 * corpus. `engine` is the `<package>@<version>` the verdict is stamped with.
 */
export class CompareSurfaces extends Schema.TaggedClass<CompareSurfaces>()('CompareSurfaces', {
  engine: Schema.String,
  before: ApiModel,
  after: ApiModel,
  corpus: RuleCorpus,
}) {
  // The surfaces and corpus are documents, not span attributes; the verdict cell's span names the operation.
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
