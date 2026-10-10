export { canonicalJson, canonicalKey, compareCodeUnits } from './canonical-json.ts'
export type { Change, ChangeKind, Direction, Position } from './diff/change.ts'
export { diffModels } from './diff/diff.ts'
export {
  API_MODEL_SCHEMA_VERSION,
  type ApiItem,
  ApiModel,
  decodeApiModel,
  encodeApiModel,
  type EntryPoint,
} from './model/api-model.ts'
export { normaliseType, sortModel, typeKey } from './model/normalise.ts'
export type { Member, Parameter, Signature, TypeExpr, TypeParameter } from './model/type-expr.ts'
export { type Bump, type ChannelType, decodeRuleCorpus, defaultCorpus, type Rule, type RuleCorpus } from './rules/corpus.ts'
export { ENGINE } from './version.ts'
export { classify, type Finding, maxBump, serialiseVerdict, verdict, type Verdict, VERDICT_SCHEMA_VERSION } from './verdict.ts'
