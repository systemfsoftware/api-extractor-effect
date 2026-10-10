/**
 * The versioned API model: one package's public surface as data.
 */
export {
  API_MODEL_SCHEMA_VERSION as SCHEMA_VERSION,
  ApiItem,
  ApiModel,
  decodeApiModel as decode,
  encodeApiModel as encode,
  type EntryPoint,
  type Producer,
  TypeAliasItem,
} from './model/api-model.ts'
export { normaliseType, sortModel as sort, typeKey } from './model/normalise.ts'
export { serialiseApiModel as serialise } from './model/serialise.ts'
export { type KeywordName, Member, Parameter, Signature, TypeExpr, TypeParameter } from './model/type-expr.ts'
