import { Array as Arr, Effect, HashMap, HashSet, Match, Option, Order } from 'effect'
import {
  type Class,
  type Comment,
  type Expression,
  type Program,
  type TSClassImplements,
  type TSImportType,
  type TSInterfaceHeritage,
  type TSTypeName,
  type TSTypeQuery,
  type TSTypeReference,
  Visitor,
} from 'oxc-parser'
import type { AnalysisMessage, AnalysisMessageId } from './analysis-message.schema.ts'
import type { Declaration, DeclarationGraph, FileScope, ResolvedSymbol } from './declaration-graph.ts'
import { declarationGraph, exportedNames, exportedSymbol, resolveName } from './declaration-graph.ts'
import type { Declarations } from './declarations.schema.ts'
import type { UnsupportedDeclaration } from './front-end-error.schema.ts'

type ReleaseTag = 'internal' | 'alpha' | 'beta' | 'public'

const RELEASE_TAG_RANK: Record<ReleaseTag, number> = { internal: 1, alpha: 2, beta: 3, public: 4 }
const RELEASE_TAG_TEXT = /@(public|beta|alpha|internal)\b/
const RELEASE_TAG_NAMES: HashSet.HashSet<string> = HashSet.make('public', 'beta', 'alpha', 'internal')

const isReleaseTag = (name: string): name is ReleaseTag => HashSet.has(RELEASE_TAG_NAMES, name)

const tagOfComment = (comment: string): Option.Option<ReleaseTag> =>
  Option.flatMap(Option.fromNullishOr(RELEASE_TAG_TEXT.exec(comment)), (match) =>
    Option.flatMap(Option.fromNullishOr(match[1]), (name) => Option.liftPredicate(name, isReleaseTag)))

const isDocComment = (comment: Comment): boolean => comment.type === 'Block' && comment.value.startsWith('*')

const leadingCommentOf = (scope: FileScope, statementStart: number): Option.Option<Comment> =>
  Arr.findLast(scope.comments, (comment) => isDocComment(comment) && comment.end <= statementStart)

const declaredTagOf = (scope: FileScope, declaration: Declaration): Option.Option<ReleaseTag> =>
  Option.flatMap(leadingCommentOf(scope, declaration.statementStart), (comment) => tagOfComment(comment.value))

const tagOf = (graph: DeclarationGraph, file: string, declaration: Declaration): Option.Option<ReleaseTag> =>
  Option.flatMap(HashMap.get(graph.files, file), (scope) => declaredTagOf(scope, declaration))

const effectiveTagOf = (tag: Option.Option<ReleaseTag>): ReleaseTag => Option.getOrElse(tag, () => 'public')

type NameNode = TSTypeName | TSImportType | Expression

const rootNameOf = (node: NameNode | null): Option.Option<string> =>
  Match.value(node).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.some(identifier.name)),
    Match.when({ type: 'TSQualifiedName' }, (qualified) => rootNameOf(qualified.left)),
    Match.when({ type: 'MemberExpression' }, (member) => rootNameOf(member.object)),
    Match.orElse(() => Option.none()),
  )

type Reference = { readonly start: number; readonly name: string }

type ReferenceScan = {
  readonly references: ReadonlyArray<Reference>
  readonly typeParameters: HashSet.HashSet<string>
}

const EMPTY_SCAN: ReferenceScan = { references: [], typeParameters: HashSet.empty() }

const scanOf = (program: Program): ReferenceScan => {
  const references: Array<Reference> = []
  const typeParameters: Array<string> = []
  const record = (node: NameNode | null, start: number): void =>
    Option.match(rootNameOf(node), { onNone: () => undefined, onSome: (name) => void references.push({ start, name }) })
  new Visitor({
    TSTypeReference: (node: TSTypeReference) => record(node.typeName, node.start),
    TSTypeQuery: (node: TSTypeQuery) => record(node.exprName, node.start),
    TSInterfaceHeritage: (node: TSInterfaceHeritage) => record(node.expression, node.start),
    TSClassImplements: (node: TSClassImplements) => record(node.expression, node.start),
    ClassDeclaration: (node: Class) => record(node.superClass, node.start),
    TSTypeParameter: (node) => void typeParameters.push(node.name.name),
  }).visit(program)
  return { references, typeParameters: HashSet.fromIterable(typeParameters) }
}

const scansOf = (graph: DeclarationGraph): HashMap.HashMap<string, ReferenceScan> =>
  HashMap.fromIterable(Arr.map(Arr.fromIterable(HashMap.values(graph.files)), (scope): readonly [string, ReferenceScan] => [scope.path, scanOf(scope.program)]))

type Resolution = {
  readonly graph: DeclarationGraph
  readonly scans: HashMap.HashMap<string, ReferenceScan>
}

const resolutionOf = (graph: DeclarationGraph): Resolution => ({ graph, scans: scansOf(graph) })

const scanFor = (resolution: Resolution, file: string): ReferenceScan =>
  Option.getOrElse(HashMap.get(resolution.scans, file), () => EMPTY_SCAN)

const statementEndOf = (scope: FileScope, statementStart: number): number =>
  Option.getOrElse(
    Option.map(Arr.findFirst(scope.program.body, (statement) => statement.start === statementStart), (statement) => statement.end),
    () => statementStart,
  )

const referencesWithin = (scan: ReferenceScan, scope: FileScope, declaration: Declaration): ReadonlyArray<Reference> =>
  Arr.filter(scan.references, (reference) =>
    reference.start >= declaration.statementStart && reference.start < statementEndOf(scope, declaration.statementStart))

const referenceNames = (scan: ReferenceScan, scope: FileScope, declaration: Declaration): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(referencesWithin(scan, scope, declaration), (reference) => !HashSet.has(scan.typeParameters, reference.name)),
    (reference) => reference.name,
  )

type EntryPoint = {
  readonly exportPath: string
  readonly declarationFile: string
}

type ExportedItem = {
  readonly file: string
  readonly name: string
  readonly namePath: string
  readonly declarations: ReadonlyArray<Declaration>
  readonly exportNames: ReadonlyArray<string>
}

const itemKey = (file: string, name: string): string => `${file}\u0000${name}`

const pathOf = (prefix: string, name: string): string => (prefix === '' ? name : `${prefix}.${name}`)

const itemAt = (file: string, name: string, namePath: string, declarations: ReadonlyArray<Declaration>, exportName: string): ExportedItem => ({
  file,
  name,
  namePath,
  declarations,
  exportNames: [exportName],
})

const symbolItems = (graph: DeclarationGraph, seen: HashSet.HashSet<string>, file: string, prefix: string, name: string, symbol: ResolvedSymbol): ReadonlyArray<ExportedItem> =>
  Match.value(symbol).pipe(
    Match.when({ kind: 'local' }, (local) => [itemAt(local.file, local.name, pathOf(prefix, name), local.declarations, name)]),
    Match.when({ kind: 'namespace' }, (namespace) => itemsInFile(graph, HashSet.add(seen, file), namespace.file, pathOf(prefix, name))),
    Match.orElse(() => []),
  )

const itemsOfName = (graph: DeclarationGraph, seen: HashSet.HashSet<string>, file: string, prefix: string, name: string): ReadonlyArray<ExportedItem> =>
  Option.match(exportedSymbol(graph, file, name), {
    onNone: () => [],
    onSome: (symbol) => symbolItems(graph, seen, file, prefix, name, symbol),
  })

const itemsInFile = (graph: DeclarationGraph, seen: HashSet.HashSet<string>, file: string, prefix: string): ReadonlyArray<ExportedItem> =>
  HashSet.has(seen, file)
    ? []
    : Arr.flatMap(exportedNames(graph, file), (name) => itemsOfName(graph, HashSet.add(seen, file), file, prefix, name))

const itemList = (graph: DeclarationGraph, entryFile: string): ReadonlyArray<ExportedItem> => itemsInFile(graph, HashSet.empty(), entryFile, '')

const intoItem = (existing: Option.Option<ExportedItem>, item: ExportedItem): ExportedItem =>
  Option.match(existing, {
    onNone: () => item,
    onSome: (known) => ({ ...known, exportNames: Arr.dedupe([...known.exportNames, ...item.exportNames]) }),
  })

const mergeByKey = (items: ReadonlyArray<ExportedItem>): HashMap.HashMap<string, ExportedItem> =>
  Arr.reduce(items, HashMap.empty<string, ExportedItem>(), (merged, item) =>
    HashMap.set(merged, itemKey(item.file, item.name), intoItem(HashMap.get(merged, itemKey(item.file, item.name)), item)))

const analysisMessage = (messageId: AnalysisMessageId, entryPoint: string, item: string, symbol: string): AnalysisMessage => ({
  messageId,
  entryPoint,
  item,
  symbol,
})

const untagged = (graph: DeclarationGraph, item: ExportedItem): ReadonlyArray<Declaration> =>
  Arr.filter(item.declarations, (declaration) => Option.isNone(tagOf(graph, item.file, declaration)))

const missingTagMessages = (graph: DeclarationGraph, entry: EntryPoint, item: ExportedItem): ReadonlyArray<AnalysisMessage> =>
  Arr.map(untagged(graph, item), (declaration) => analysisMessage('ae-missing-release-tag', entry.exportPath, item.namePath, declaration.declared.name))

const needsUnderscore = (maxTag: ReleaseTag, item: ExportedItem): boolean => maxTag === 'internal' && !item.namePath.includes('.')

const underscoreMessages = (maxTag: ReleaseTag, entry: EntryPoint, item: ExportedItem): ReadonlyArray<AnalysisMessage> =>
  needsUnderscore(maxTag, item)
    ? Arr.map(item.exportNames, (name) => analysisMessage('ae-internal-missing-underscore', entry.exportPath, item.namePath, name))
    : []

const allTagged = (maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): boolean => Arr.every(tags, (tag) => tag === maxTag)

const mixedTagged = (maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): boolean =>
  !allTagged(maxTag, tags) && Arr.some(tags, (tag) => tag === 'internal')

const mixedMessages = (entry: EntryPoint, item: ExportedItem, maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): ReadonlyArray<AnalysisMessage> =>
  mixedTagged(maxTag, tags) ? [analysisMessage('ae-internal-mixed-release-tag', entry.exportPath, item.namePath, item.name)] : []

const effectiveTagsOf = (graph: DeclarationGraph, item: ExportedItem): ReadonlyArray<ReleaseTag> =>
  Arr.map(item.declarations, (declaration) => effectiveTagOf(tagOf(graph, item.file, declaration)))

const maxTagOf = (tags: ReadonlyArray<ReleaseTag>): ReleaseTag =>
  Arr.reduce(tags, Option.getOrElse(Arr.head(tags), (): ReleaseTag => 'public'), (max: ReleaseTag, tag: ReleaseTag) =>
    RELEASE_TAG_RANK[tag] > RELEASE_TAG_RANK[max] ? tag : max)

const maxTagIn = (graph: DeclarationGraph, item: ExportedItem): ReleaseTag => maxTagOf(effectiveTagsOf(graph, item))

const morePublic = (declaring: ReleaseTag, referenced: ReleaseTag): boolean => RELEASE_TAG_RANK[declaring] > RELEASE_TAG_RANK[referenced]

const declaringTag = (graph: DeclarationGraph, file: string, declaration: Declaration): ReleaseTag => effectiveTagOf(tagOf(graph, file, declaration))

const incompatibleMessages = (
  graph: DeclarationGraph,
  entry: EntryPoint,
  item: ExportedItem,
  declaration: Declaration,
  referenced: ExportedItem,
): ReadonlyArray<AnalysisMessage> =>
  morePublic(declaringTag(graph, item.file, declaration), maxTagIn(graph, referenced))
    ? [analysisMessage('ae-incompatible-release-tags', entry.exportPath, item.namePath, item.name)]
    : []

const localMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
  declaration: Declaration,
  symbol: Extract<ResolvedSymbol, { kind: 'local' }>,
): ReadonlyArray<AnalysisMessage> =>
  Option.match(HashMap.get(consumable, itemKey(symbol.file, symbol.name)), {
    onNone: () => [analysisMessage('ae-forgotten-export', entry.exportPath, item.namePath, symbol.name)],
    onSome: (referenced) => incompatibleMessages(resolution.graph, entry, item, declaration, referenced),
  })

const resolvedNameMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
  declaration: Declaration,
  symbol: ResolvedSymbol,
): ReadonlyArray<AnalysisMessage> =>
  Match.value(symbol).pipe(
    Match.when({ kind: 'local' }, (local) => localMessages(resolution, entry, consumable, item, declaration, local)),
    Match.orElse(() => []),
  )

const nameMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
  declaration: Declaration,
  name: string,
): ReadonlyArray<AnalysisMessage> =>
  Option.match(resolveName(resolution.graph, item.file, name), {
    onNone: () => [],
    onSome: (symbol) => resolvedNameMessages(resolution, entry, consumable, item, declaration, symbol),
  })

const declarationMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
  declaration: Declaration,
): ReadonlyArray<AnalysisMessage> =>
  Option.match(HashMap.get(resolution.graph.files, item.file), {
    onNone: () => [],
    onSome: (scope) =>
      Arr.flatMap(referenceNames(scanFor(resolution, item.file), scope, declaration), (name) =>
        nameMessages(resolution, entry, consumable, item, declaration, name)),
  })

const referenceMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
): ReadonlyArray<AnalysisMessage> =>
  Arr.flatMap(item.declarations, (declaration) => declarationMessages(resolution, entry, consumable, item, declaration))

const itemMessages = (
  resolution: Resolution,
  entry: EntryPoint,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
): ReadonlyArray<AnalysisMessage> => {
  const tags = effectiveTagsOf(resolution.graph, item)
  const maxTag = maxTagOf(tags)
  return [
    ...missingTagMessages(resolution.graph, entry, item),
    ...underscoreMessages(maxTag, entry, item),
    ...mixedMessages(entry, item, maxTag, tags),
    ...referenceMessages(resolution, entry, consumable, item),
  ]
}

const entryMessages = (resolution: Resolution, entry: EntryPoint): ReadonlyArray<AnalysisMessage> => {
  const consumable = mergeByKey(itemList(resolution.graph, entry.declarationFile))
  return Arr.flatMap(Arr.fromIterable(HashMap.values(consumable)), (item) => itemMessages(resolution, entry, consumable, item))
}

const messageKey = (message: AnalysisMessage): string => [message.messageId, message.entryPoint, message.item, message.symbol].join('\u0000')

const deduped = (messages: ReadonlyArray<AnalysisMessage>): ReadonlyArray<AnalysisMessage> =>
  Arr.fromIterable(HashMap.values(Arr.reduce(messages, HashMap.empty<string, AnalysisMessage>(), (known, message) => HashMap.set(known, messageKey(message), message))))

const analysisMessageOrder: Order.Order<AnalysisMessage> = Order.combineAll([
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.messageId),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.entryPoint),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.item),
  Order.mapInput(Order.String, (message: AnalysisMessage) => message.symbol),
])

const messagesFor = (graph: DeclarationGraph): ReadonlyArray<AnalysisMessage> => {
  const resolution = resolutionOf(graph)
  return Arr.sort(deduped(Arr.flatMap(graph.entryPoints, (entry) => entryMessages(resolution, entry))), analysisMessageOrder)
}

export const resolveMessages = (declarations: Declarations): Effect.Effect<ReadonlyArray<AnalysisMessage>, UnsupportedDeclaration> =>
  Effect.map(declarationGraph(declarations), messagesFor)
