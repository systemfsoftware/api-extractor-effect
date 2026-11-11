/**
 * The versioned API model: one package's public surface as data.
 */
export {
  AnchorBase,
  API_MODEL_SCHEMA_VERSION as SCHEMA_VERSION,
  ApiItem,
  ApiModel,
  type ClassItem,
  Coverage,
  CoverageReason,
  decodeApiModel as decode,
  encodeApiModel as encode,
  type EntryPoint,
  EntryPointTarget,
  type EnumItem,
  type EnumMember,
  type FunctionItem,
  type InterfaceItem,
  ManifestEntry,
  type NamespaceItem,
  PackageSurface,
  type Producer,
  sortModel as sort,
  TypeAliasItem,
  type VariableItem,
} from './model/api-model.schema.ts'
export { Anchor, ItemMeta, ReleaseTag } from './model/anchor.schema.ts'
export { AnalysisMessage } from './model/message.schema.ts'
export { serialiseApiModel as serialise } from './model/serialise.ts'
export {
  type ArrayType,
  type CallMember,
  type FunctionType,
  type IntersectionType,
  KeywordName,
  type KeywordType,
  type LiteralType,
  Member,
  type MethodMember,
  normaliseType,
  type ObjectType,
  Parameter,
  type PropertyMember,
  type ReferenceType,
  Signature,
  type TextType,
  type TupleType,
  TypeExpr,
  typeKey,
  TypeParameter,
  type UnionType,
} from './model/type-expr.schema.ts'
