/**
 * The semver verdict between two API models: the diff, the declarative rule
 * corpus, the pure decision that judges them, and the cell that runs it.
 */
export { type Change, ChangeKind, Direction, Position } from './diff/change.ts'
export { diffModels as diff } from './diff/diff.ts'
export { bumpOf, classify, maxBump, UNCLASSIFIED } from './findings.ts'
export { judgeSurfaces as judge } from './judge-surfaces.workflow.ts'
export { Bump, type ChannelType, decodeRuleCorpus, defaultCorpus, type Rule, RuleCorpus } from './rules/corpus.ts'
export { RuleCorpusRejected, SurfaceRejected, verdictCell as cell, type VerdictInput as Input } from './verdict.cell.ts'
export { AmbiguousRuleCorpus, CompareSurfaces, Finding, Verdict, VERDICT_SCHEMA_VERSION as SCHEMA_VERSION, VerdictTypeId } from './verdict.schema.ts'
export { ENGINE } from './version.ts'
