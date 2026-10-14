import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Cause, Schema } from 'effect'
import { ApiModel } from './model/api-model.schema.ts'
import { Bump, RuleCorpus } from './rules/corpus.schema.ts'
import { Findings } from './rules/finding.schema.ts'

/** The verdict document's wire version. */
export const VerdictVersion: Schema.Literal<1> = Schema.Literal(1)
export type VerdictVersion = typeof VerdictVersion.Type

export const VERDICT_SCHEMA_VERSION: VerdictVersion = 1

/** The family brand every outcome of the verdict decision carries. */
export const VerdictTypeId: unique symbol = Symbol.for('@systemfsoftware/api-extractor/Verdict')

type VerdictFields = {
  readonly schemaVersion: typeof VerdictVersion
  readonly engine: Schema.String
  readonly corpusVersion: Schema.String
  readonly declarations: Schema.Struct<{ readonly before: Schema.String; readonly after: Schema.String }>
  readonly bump: typeof Bump
  readonly findings: typeof Findings
}

type VerdictStruct = Schema.TaggedStruct<'Verdict', VerdictFields>
type VerdictBrand = { readonly [VerdictTypeId]: symbol }
type VerdictValue = VerdictStruct['Type']

/** The semver bump two surfaces of one package call for, with the findings behind it. */
export interface Verdict extends VerdictValue, VerdictBrand {}

// Under isolatedDeclarations a class may neither extend an expression (TS9021) nor declare a
// computed member (TS9038), so the schema class is a typed constant and the brand sits on its prototype.
export const Verdict: Schema.Class<Verdict, VerdictStruct, VerdictBrand> = Schema.TaggedClass<Verdict, VerdictBrand>()('Verdict', {
  schemaVersion: VerdictVersion,
  engine: Schema.String,
  corpusVersion: Schema.String,
  declarations: Schema.Struct({ before: Schema.String, after: Schema.String }),
  bump: Bump,
  findings: Findings,
})
Object.defineProperty(Verdict.prototype, VerdictTypeId, { value: VerdictTypeId })

type CorpusAmbiguityFields = {
  readonly corpusVersion: Schema.String
  readonly ambiguities: Schema.$Array<Schema.String>
}

/** The corpus a refusal names, and each way its rules fail to pick one rule per change. */
export const CorpusAmbiguities: CorpusAmbiguityFields = {
  corpusVersion: Schema.String,
  ambiguities: Schema.Array(Schema.String),
}

const ambiguityMessage = ({ corpusVersion, ambiguities }: { readonly corpusVersion: string; readonly ambiguities: ReadonlyArray<string> }): string =>
  `rule corpus ${corpusVersion} cannot pick one rule per change: ${ambiguities.join('; ')}`

const AmbiguousRuleCorpusBase: Schema.Class<AmbiguousRuleCorpus, Schema.TaggedStruct<'AmbiguousRuleCorpus', CorpusAmbiguityFields>, Cause.YieldableError> =
  Schema.TaggedError<AmbiguousRuleCorpus>()('AmbiguousRuleCorpus', CorpusAmbiguities)

/** A corpus whose rules do not pick one rule per change: two rules share a match, or a rule id repeats. */
export class AmbiguousRuleCorpus extends AmbiguousRuleCorpusBase {
  override get message(): string {
    return ambiguityMessage(this)
  }
}

const SurfaceRejectedBase: Schema.Class<SurfaceRejected, Schema.TaggedStruct<'SurfaceRejected', { readonly issue: Schema.String }>, Cause.YieldableError> =
  Schema.TaggedError<SurfaceRejected>()('SurfaceRejected', { issue: Schema.String })

/** A surface or corpus that does not decode against its schema. */
export class SurfaceRejected extends SurfaceRejectedBase {
  override get message(): string {
    return `a surface or the corpus does not decode: ${this.issue}`
  }
}

const RuleCorpusRejectedBase: Schema.Class<RuleCorpusRejected, Schema.TaggedStruct<'RuleCorpusRejected', CorpusAmbiguityFields>, Cause.YieldableError> =
  Schema.TaggedError<RuleCorpusRejected>()('RuleCorpusRejected', CorpusAmbiguities)

/** A corpus whose rules cannot pick one rule per change, refused by the verdict cell. */
export class RuleCorpusRejected extends RuleCorpusRejectedBase {
  override get message(): string {
    return ambiguityMessage(this)
  }
}

type CompareSurfacesFields = {
  readonly engine: Schema.String
  readonly before: typeof ApiModel
  readonly after: typeof ApiModel
  readonly corpus: typeof RuleCorpus
}

type CompareSurfacesStruct = Schema.TaggedStruct<'CompareSurfaces', CompareSurfacesFields>

/**
 * Judge the change from one surface of a package to the next against a rule
 * corpus. `engine` is the `<package>@<version>` the verdict is stamped with.
 */
export type CompareSurfaces = CompareSurfacesStruct['Type']

// The surfaces and corpus are documents, not span attributes, so the instrumentation map is empty;
// the verdict cell's span names the operation.
export const CompareSurfaces:
  & Schema.Class<CompareSurfaces, CompareSurfacesStruct, {}>
  & { readonly [Workflow.InstrumentationBrand]: {} } = Object.assign(
    Schema.TaggedClass<CompareSurfaces>()('CompareSurfaces', {
      engine: Schema.String,
      before: ApiModel,
      after: ApiModel,
      corpus: RuleCorpus,
    }),
    { [Workflow.InstrumentationBrand]: {} },
  )
