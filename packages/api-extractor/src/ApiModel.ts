/**
 * The versioned API model: one package's public surface as data.
 */
export {
  API_MODEL_SCHEMA_VERSION as SCHEMA_VERSION,
  ApiItem,
  ApiModel,
  type ClassItem,
  decodeApiModel as decode,
  encodeApiModel as encode,
  type EntryPoint,
  type EnumItem,
  type EnumMember,
  type FunctionItem,
  type InterfaceItem,
  type NamespaceItem,
  type Producer,
  TypeAliasItem,
  type VariableItem,
} from './model/api-model.ts'
export { normaliseType, sortModel as sort, typeKey } from './model/normalise.ts'
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
  type ObjectType,
  Parameter,
  type PropertyMember,
  type ReferenceType,
  Signature,
  type TextType,
  type TupleType,
  TypeExpr,
  TypeParameter,
  type UnionType,
} from './model/type-expr.ts'
