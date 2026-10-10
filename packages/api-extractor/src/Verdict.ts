/**
 * The semver verdict between two API models: the diff, the declarative rule
 * corpus, the pure decision that judges them, and the cell that runs it.
 */
export { type Change, ChangeKind, type Changes, diffModels as diff } from './diff/change.schema.ts'
export { Direction } from './diff/direction.schema.ts'
export { ChannelType, Position, Variance } from './diff/position.schema.ts'
export { judgeSurfaces as judge } from './judge-surfaces.workflow.ts'
export { Bump, classify, decodeRuleCorpus, maxBump, type Rule, RuleCorpus, type RuleMatch, UNCLASSIFIED } from './rules/corpus.schema.ts'
export { defaultCorpus } from './rules/default-corpus.ts'
export { bumpOf, Finding, Findings } from './rules/finding.schema.ts'
export { type VerdictInput as Input, verdictCell as cell } from './verdict.cell.ts'
export {
  AmbiguousRuleCorpus,
  CompareSurfaces,
  RuleCorpusRejected,
  SurfaceRejected,
  Verdict,
  VERDICT_SCHEMA_VERSION as SCHEMA_VERSION,
  VerdictTypeId,
} from './verdict.schema.ts'
export { ENGINE } from './version.ts'
