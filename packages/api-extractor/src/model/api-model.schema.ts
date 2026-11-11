import { Array as Arr, Order, Schema } from 'effect'
import { canonicalKey, type Json } from '../canonical-json.schema.ts'
import { Anchor, type ItemMeta, ReleaseTag } from './anchor.schema.ts'
import { AnalysisMessage } from './message.schema.ts'
import { Member, Signature, TypeExpr, TypeParameter } from './type-expr.schema.ts'

/** The model's wire version. Any change to the model schema bumps it. */
export const ModelVersion: Schema.Literal<3> = Schema.Literal(3)
export type ModelVersion = typeof ModelVersion.Type

export const API_MODEL_SCHEMA_VERSION: ModelVersion = 3

/** Where anchors are rooted: the workspace root, or the package root when it is its own. */
const ANCHOR_BASES = ['workspace', 'package'] as const

export const AnchorBase: Schema.Literals<typeof ANCHOR_BASES> = Schema.Literals(ANCHOR_BASES)
export type AnchorBase = typeof AnchorBase.Type

export type FunctionItem = {
  readonly kind: 'function'
  readonly name: string
  readonly signatures: ReadonlyArray<Signature>
} & ItemMeta

export type VariableItem = {
  readonly kind: 'variable'
  readonly name: string
  readonly constant: boolean
  readonly type: TypeExpr
} & ItemMeta

export type TypeAliasItem = {
  readonly kind: 'typeAlias'
  readonly name: string
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly type: TypeExpr
} & ItemMeta

export type InterfaceItem = {
  readonly kind: 'interface'
  readonly name: string
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly extends: ReadonlyArray<TypeExpr>
  readonly members: ReadonlyArray<Member>
} & ItemMeta

export type ClassItem = {
  readonly kind: 'class'
  readonly name: string
  readonly abstract: boolean
  readonly typeParameters: ReadonlyArray<TypeParameter>
  readonly extends: ReadonlyArray<TypeExpr>
  readonly implements: ReadonlyArray<TypeExpr>
  readonly members: ReadonlyArray<Member>
} & ItemMeta

export type EnumMember = {
  readonly name: string
  readonly value?: string
}

export type EnumItem = {
  readonly kind: 'enum'
  readonly name: string
  readonly const: boolean
  readonly members: ReadonlyArray<EnumMember>
} & ItemMeta

export type NamespaceItem = {
  readonly kind: 'namespace'
  readonly name: string
  readonly items: ReadonlyArray<ApiItem>
} & ItemMeta

export type ApiItem =
  | FunctionItem
  | VariableItem
  | TypeAliasItem
  | InterfaceItem
  | ClassItem
  | EnumItem
  | NamespaceItem

/** The export-map target an entry point was read from. */
export type EntryPointTarget = {
  readonly key: string
  readonly condition: string | null
  readonly path: string
}

export const EntryPointTarget: Schema.Codec<EntryPointTarget> = Schema.Struct({
  key: Schema.String,
  condition: Schema.NullOr(Schema.String),
  path: Schema.String,
})

export type EntryPoint = {
  /** The package export path, e.g. `.` or `./schema`. */
  readonly path: string
  readonly target: EntryPointTarget
  readonly items: ReadonlyArray<ApiItem>
  /** Type aliases the entry point uses but does not export. */
  readonly locals: ReadonlyArray<TypeAliasItem>
}

/** One key of the package's `exports` or `imports` map and the target it resolved to. */
export type ManifestEntry = {
  readonly key: string
  readonly target: string | null
  readonly condition: string | null
}

export const ManifestEntry: Schema.Codec<ManifestEntry> = Schema.Struct({
  key: Schema.String,
  target: Schema.NullOr(Schema.String),
  condition: Schema.NullOr(Schema.String),
})

/** The package the model describes and the maps its consumers resolve. */
export type PackageSurface = {
  readonly name: string
  readonly version: string
  readonly exports: ReadonlyArray<ManifestEntry>
  readonly imports: ReadonlyArray<ManifestEntry>
}

export const PackageSurface: Schema.Codec<PackageSurface> = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  exports: Schema.Array(ManifestEntry),
  imports: Schema.Array(ManifestEntry),
})

const COVERAGE_KINDS = [
  'unsupported',
  'unresolved',
  'unmapped-anchor',
  'pattern-empty',
  'parse',
  'external-star',
] as const

export const CoverageKind: Schema.Literals<typeof COVERAGE_KINDS> = Schema.Literals(COVERAGE_KINDS)
export type CoverageKind = typeof CoverageKind.Type

/** Why the analysis of a package is not complete. */
export type CoverageReason = {
  readonly kind: CoverageKind
  readonly file?: string
  readonly construct?: string
  readonly detail: string
}

export const CoverageReason: Schema.Codec<CoverageReason> = Schema.Struct({
  kind: CoverageKind,
  file: Schema.optionalKey(Schema.String),
  construct: Schema.optionalKey(Schema.String),
  detail: Schema.String,
})

export type Coverage = {
  readonly complete: boolean
  readonly reasons: ReadonlyArray<CoverageReason>
}

export const Coverage: Schema.Codec<Coverage> = Schema.Struct({
  complete: Schema.Boolean,
  reasons: Schema.Array(CoverageReason),
})

export type Producer = {
  /** The engine name and version that built the model. */
  readonly engine: string
  /** The compiler or emitter that produced the declarations the model was built from. */
  readonly declarations: string
}

export type ApiModel = {
  readonly schemaVersion: ModelVersion
  readonly producer: Producer
  readonly package: PackageSurface
  readonly anchorBase: AnchorBase
  readonly entryPoints: ReadonlyArray<EntryPoint>
  readonly messages: ReadonlyArray<AnalysisMessage>
  readonly coverage: Coverage
}

const uniqueBy = <A>(what: string, key: (value: A) => string) =>
  Schema.makeFilter((values: ReadonlyArray<A>) => new Set(values.map(key)).size === values.length, {
    expected: `${what} unique by key`,
    arbitraryConstraint: { uniqueBy: key },
  })

const typeParameters = Schema.Array(TypeParameter)

/** The item fields the model shares: spread into every item kind's struct. */
const itemMetaFields = {
  anchor: Schema.NullOr(Anchor),
  releaseTag: ReleaseTag,
  stability: Schema.NullOr(Schema.String),
} as const

export const TypeAliasItem: Schema.Codec<TypeAliasItem> = Schema.Struct({
  kind: Schema.Literal('typeAlias'),
  name: Schema.String,
  typeParameters,
  type: TypeExpr,
  ...itemMetaFields,
})

const apiItem = Schema.suspend((): Schema.Codec<ApiItem> => ApiItem)

/** The recursion point of the item tree (namespaces nest items); generation stays within the declared budget. */
export const ApiItem: Schema.Codec<ApiItem> = Schema.suspend((): Schema.Codec<ApiItem> => Schema.Union([
  Schema.Struct({ kind: Schema.Literal('function'), name: Schema.String, signatures: Schema.Array(Signature), ...itemMetaFields }),
  Schema.Struct({ kind: Schema.Literal('variable'), name: Schema.String, constant: Schema.Boolean, type: TypeExpr, ...itemMetaFields }),
  TypeAliasItem,
  Schema.Struct({
    kind: Schema.Literal('interface'),
    name: Schema.String,
    typeParameters,
    extends: Schema.Array(TypeExpr),
    members: Schema.Array(Member),
    ...itemMetaFields,
  }),
  Schema.Struct({
    kind: Schema.Literal('class'),
    name: Schema.String,
    abstract: Schema.Boolean,
    typeParameters,
    extends: Schema.Array(TypeExpr),
    implements: Schema.Array(TypeExpr),
    members: Schema.Array(Member),
    ...itemMetaFields,
  }),
  Schema.Struct({
    kind: Schema.Literal('enum'),
    name: Schema.String,
    const: Schema.Boolean,
    members: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.optionalKey(Schema.String) })).check(
      uniqueBy('enum members', (member: { readonly name: string }) => member.name),
    ),
    ...itemMetaFields,
  }),
  Schema.Struct({ kind: Schema.Literal('namespace'), name: Schema.String, items: Schema.Array(apiItem), ...itemMetaFields }),
])).annotate({ recursionBudget: { maxDepth: 8, depthSize: 'small' } })

export const EntryPoint: Schema.Codec<EntryPoint> = Schema.Struct({
  path: Schema.String,
  target: EntryPointTarget,
  items: Schema.Array(ApiItem),
  locals: Schema.Array(TypeAliasItem),
})

export const ApiModel: Schema.Codec<ApiModel> = Schema.Struct({
  schemaVersion: ModelVersion,
  producer: Schema.Struct({ engine: Schema.String, declarations: Schema.String }),
  package: PackageSurface,
  anchorBase: AnchorBase,
  entryPoints: Schema.Array(EntryPoint).check(uniqueBy('entry points', (entry: { readonly path: string }) => entry.path)),
  messages: Schema.Array(AnalysisMessage),
  coverage: Coverage,
})

/** Decodes a JSON value (e.g. parsed JSON) into a model; rejects any other `schemaVersion`. */
export const decodeApiModel: (input: Json) => ApiModel = Schema.decodeUnknownSync(ApiModel)

/** The model as a JSON value. */
export const encodeApiModel: (model: ApiModel) => Json = Schema.encodeSync(ApiModel)

/** By name; items sharing a name (a value beside a type) by kind, then by content, so input order never shows. */
const itemOrder: Order.Order<ApiItem> = Order.combineAll([
  Order.mapInput(Order.String, (item: ApiItem) => item.name),
  Order.mapInput(Order.String, (item: ApiItem) => item.kind),
  Order.mapInput(Order.String, canonicalKey),
])

const byName = <A extends ApiItem>(values: ReadonlyArray<A>): ReadonlyArray<A> => Arr.sort(values, itemOrder)

const sortItem = (item: ApiItem): ApiItem =>
  item.kind === 'namespace' ? { ...item, items: byName(item.items.map(sortItem)) } : item

const sortEntryPoint = (entryPoint: EntryPoint): EntryPoint => ({
  path: entryPoint.path,
  target: entryPoint.target,
  items: byName(entryPoint.items.map(sortItem)),
  locals: byName<TypeAliasItem>(entryPoint.locals),
})

const byManifestKey: Order.Order<ManifestEntry> = Order.mapInput(Order.String, (entry: ManifestEntry) => entry.key)

const messageOrder: Order.Order<AnalysisMessage> = Order.combineAll([
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.messageId),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.entryPoint),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.item),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.symbol),
])

const coverageOrder: Order.Order<CoverageReason> = Order.combineAll([
  Order.mapInput(Order.String, (reason: CoverageReason) => reason.kind),
  Order.mapInput(Order.String, (reason: CoverageReason) => reason.file ?? ''),
  Order.mapInput(Order.String, (reason: CoverageReason) => reason.construct ?? ''),
  Order.mapInput(Order.String, (reason: CoverageReason) => reason.detail),
])

/** Orders entry points, manifest keys, messages and coverage reasons by code unit, so equal surfaces serialise to equal bytes. */
export const sortModel = (model: ApiModel): ApiModel => ({
  ...model,
  package: {
    ...model.package,
    exports: Arr.sort(model.package.exports, byManifestKey),
    imports: Arr.sort(model.package.imports, byManifestKey),
  },
  entryPoints: Arr.sort(
    model.entryPoints.map(sortEntryPoint),
    Order.mapInput(Order.String, (entryPoint: EntryPoint) => entryPoint.path),
  ),
  messages: Arr.sort(model.messages, messageOrder),
  coverage: { ...model.coverage, reasons: Arr.sort(model.coverage.reasons, coverageOrder) },
})
