import { type StandardModifierTagSet, TSDocParser } from '@microsoft/tsdoc'
import { Array as Arr, Effect, HashMap, HashSet, Match, Option, Order, Predicate } from 'effect'
import {
  type Class,
  type Comment,
  type Expression,
  type Program,
  type TSClassImplements,
  type TSImportType,
  type TSConditionalType,
  type TSGlobalDeclaration,
  type TSInferType,
  type TSInterfaceHeritage,
  type TSModuleBlock,
  type TSModuleDeclaration,
  type TSMappedType,
  type TSTypeName,
  type TSTypeParameterDeclaration,
  type TSTypeQuery,
  type TSTypeReference,
  Visitor,
} from 'oxc-parser'
import type { AnalysisMessage, AnalysisMessageId } from './analysis-message.schema.ts'
import { typeParameterNames } from './canonical-type-text.ts'
import type { Declaration, DeclarationGraph, EntryDeclaration, FileScope, ResolvedSymbol } from './declaration-graph.ts'
import { declarationGraph, exportedNames, exportedSymbol, namespaceSpacesOf, resolveName } from './declaration-graph.ts'
import type { Declarations } from './declarations.schema.ts'
import type { UnsupportedDeclaration } from './front-end-error.schema.ts'

type ReleaseTag = 'internal' | 'alpha' | 'beta' | 'public'

const RELEASE_TAG_RANK: Record<ReleaseTag, number> = { internal: 1, alpha: 2, beta: 3, public: 4 }

const releaseTagParser: TSDocParser = new TSDocParser()

const docCommentText = (comment: string): string => `/*${comment}*/`

const tagIn = (tags: StandardModifierTagSet): Option.Option<ReleaseTag> =>
  Match.value(tags).pipe(
    Match.when((candidate) => candidate.isPublic(), () => Option.some<ReleaseTag>('public')),
    Match.when((candidate) => candidate.isBeta(), () => Option.some<ReleaseTag>('beta')),
    Match.when((candidate) => candidate.isAlpha(), () => Option.some<ReleaseTag>('alpha')),
    Match.when((candidate) => candidate.isInternal(), () => Option.some<ReleaseTag>('internal')),
    Match.orElse(() => Option.none<ReleaseTag>()),
  )

const tagOfComment = (comment: string): Option.Option<ReleaseTag> =>
  tagIn(releaseTagParser.parseString(docCommentText(comment)).docComment.modifierTagSet)

const isDocComment = (comment: Comment): boolean => comment.type === 'Block' && comment.value.startsWith('*')

const precedingEndOf = (scope: FileScope, statementStart: number): number =>
  Arr.reduce(scope.program.body, 0, (end, statement) => (statement.end <= statementStart ? Math.max(end, statement.end) : end))

const isBetween = (floor: number, ceiling: number) => (comment: Comment): boolean => comment.start >= floor && comment.end <= ceiling

const leadingCommentOf = (scope: FileScope, statementStart: number): Option.Option<Comment> =>
  Arr.findLast(scope.comments, Predicate.and(isDocComment, isBetween(precedingEndOf(scope, statementStart), statementStart)))

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
}

type NameSpace = 'type' | 'value'

type NameScope = {
  readonly start: number
  readonly end: number
  readonly types: ReadonlyArray<string>
  readonly values: ReadonlyArray<string>
}

type ScopeCarrier = {
  readonly start: number
  readonly end: number
  readonly typeParameters?: TSTypeParameterDeclaration | null
}

const EMPTY_SCAN: ReferenceScan = { references: [] }

const withinScope = (scope: NameScope, at: number): boolean => at >= scope.start && at < scope.end

const namesIn = (scope: NameScope, space: NameSpace): ReadonlyArray<string> => (space === 'type' ? scope.types : scope.values)

const matchesName = (scope: NameScope, name: string, space: NameSpace): boolean =>
  Arr.some(namesIn(scope, space), (candidate) => candidate === name)

const shadowed = (scopes: ReadonlyArray<NameScope>, name: string, at: number, space: NameSpace): boolean =>
  Arr.some(scopes, (scope) => withinScope(scope, at) && matchesName(scope, name, space))

const addReference = (references: Array<Reference>, scopes: ReadonlyArray<NameScope>, name: string, at: number, space: NameSpace): void => {
  if (!shadowed(scopes, name, at, space)) {
    references.push({ start: at, name })
  }
}

const openScope = (scopes: Array<NameScope>, node: ScopeCarrier): void =>
  void scopes.push({ start: node.start, end: node.end, types: typeParameterNames(node.typeParameters), values: [] })

const closeScope = (scopes: Array<NameScope>): void => void scopes.pop()

const openNamedScope = (scopes: Array<NameScope>, node: TSMappedType): void =>
  void scopes.push({ start: node.start, end: node.end, types: [node.key.name], values: [] })

type ModuleDeclaration = TSModuleDeclaration | TSGlobalDeclaration

const moduleBlockOf = (node: ModuleDeclaration): Option.Option<TSModuleBlock> => Option.fromNullishOr(node.body)

const namespaceNameOf = (node: ModuleDeclaration): Option.Option<string> =>
  Match.value(node.id).pipe(
    Match.when({ type: 'Identifier' }, (id) => Option.some<string>(id.name)),
    Match.orElse(() => Option.none<string>()),
  )

const namespaceBlocksOf = (node: ModuleDeclaration): ReadonlyArray<TSModuleBlock> => Option.toArray(moduleBlockOf(node))

type MergedNamespaceBlocks = HashMap.HashMap<string, ReadonlyArray<TSModuleBlock>>

type NamespaceBlockEntry = readonly [string, TSModuleBlock]

type NamespacePathEntry = readonly [number, string]

type NamespacePass = {
  readonly blocks: ReadonlyArray<NamespaceBlockEntry>
  readonly pathsByStart: HashMap.HashMap<number, string>
}

const enterNamespacePath = (
  namespacePath: Array<string>,
  blocks: Array<NamespaceBlockEntry>,
  paths: Array<NamespacePathEntry>,
  node: ModuleDeclaration,
): void =>
  Option.match(namespaceNameOf(node), {
    onNone: () => undefined,
    onSome: (name) => {
      namespacePath.push(name)
      void paths.push([node.start, namespacePath.join('.')])
      Option.match(moduleBlockOf(node), {
        onNone: () => undefined,
        onSome: (block) => void blocks.push([namespacePath.join('.'), block]),
      })
    },
  })

const leaveNamespacePath = (namespacePath: Array<string>, node: ModuleDeclaration): void =>
  Option.match(namespaceNameOf(node), { onNone: () => undefined, onSome: () => void namespacePath.pop() })

const namespacePassOf = (program: Program): NamespacePass => {
  const namespacePath: Array<string> = []
  const blocks: Array<NamespaceBlockEntry> = []
  const paths: Array<NamespacePathEntry> = []
  new Visitor({
    TSModuleDeclaration: (node: ModuleDeclaration) => enterNamespacePath(namespacePath, blocks, paths, node),
    'TSModuleDeclaration:exit': (node: ModuleDeclaration) => leaveNamespacePath(namespacePath, node),
  }).visit(program)
  return { blocks, pathsByStart: HashMap.fromIterable(paths) }
}

const withBlock = (blocksByPath: MergedNamespaceBlocks, [path, block]: NamespaceBlockEntry): MergedNamespaceBlocks =>
  HashMap.set(blocksByPath, path, Arr.append(Option.getOrElse(HashMap.get(blocksByPath, path), () => []), block))

const mergedBlocksByPath = (blocks: ReadonlyArray<NamespaceBlockEntry>): MergedNamespaceBlocks =>
  Arr.reduce(blocks, HashMap.empty<string, ReadonlyArray<TSModuleBlock>>(), withBlock)

const namespaceBlocksAt = (blocksByPath: MergedNamespaceBlocks, path: string, node: ModuleDeclaration): ReadonlyArray<TSModuleBlock> =>
  Option.getOrElse(HashMap.get(blocksByPath, path), () => namespaceBlocksOf(node))

const namespaceScopeOf = (block: TSModuleBlock, blocks: ReadonlyArray<TSModuleBlock>): NameScope => ({
  start: block.start,
  end: block.end,
  ...namespaceSpacesOf(blocks),
})

const pushNamespaceScope = (scopes: Array<NameScope>, blocks: ReadonlyArray<TSModuleBlock>, node: ModuleDeclaration): void =>
  Option.match(moduleBlockOf(node), {
    onNone: () => undefined,
    onSome: (block) => void scopes.push(namespaceScopeOf(block, blocks)),
  })

const popNamespaceScope = (scopes: Array<NameScope>, node: ModuleDeclaration): void =>
  Option.match(moduleBlockOf(node), { onNone: () => undefined, onSome: () => closeScope(scopes) })

const openNamespaceScope = (
  scopes: Array<NameScope>,
  pathsByStart: HashMap.HashMap<number, string>,
  blocksByPath: MergedNamespaceBlocks,
  node: ModuleDeclaration,
): void =>
  Option.match(HashMap.get(pathsByStart, node.start), {
    onNone: () => pushNamespaceScope(scopes, namespaceBlocksOf(node), node),
    onSome: (path) => pushNamespaceScope(scopes, namespaceBlocksAt(blocksByPath, path, node), node),
  })

type ConditionalScope = {
  readonly start: number
  readonly end: number
  readonly extendsStart: number
  readonly extendsEnd: number
  readonly types: Array<string>
  readonly values: ReadonlyArray<string>
}

const openConditional = (scopes: Array<NameScope>, conditionals: Array<ConditionalScope>, node: TSConditionalType): void => {
  const scope: ConditionalScope = {
    start: node.start,
    end: node.trueType.end,
    extendsStart: node.extendsType.start,
    extendsEnd: node.extendsType.end,
    types: [],
    values: [],
  }
  scopes.push(scope)
  conditionals.push(scope)
}

const closeConditional = (scopes: Array<NameScope>, conditionals: Array<ConditionalScope>): void => {
  scopes.pop()
  conditionals.pop()
}

const bindsInfer = (scope: ConditionalScope, at: number): boolean => at >= scope.extendsStart && at < scope.extendsEnd

const bindInfer = (conditionals: ReadonlyArray<ConditionalScope>, node: TSInferType): void =>
  Option.match(Arr.findLast(conditionals, (scope) => bindsInfer(scope, node.start)), {
    onNone: () => undefined,
    onSome: (scope) => void scope.types.push(node.typeParameter.name.name),
  })

const scanOf = (program: Program): ReferenceScan => {
  const references: Array<Reference> = []
  const scopes: Array<NameScope> = []
  const conditionals: Array<ConditionalScope> = []
  const namespacePass = namespacePassOf(program)
  const blocksByPath = mergedBlocksByPath(namespacePass.blocks)
  const record = (node: NameNode | null, start: number, space: NameSpace): void =>
    Option.match(rootNameOf(node), { onNone: () => undefined, onSome: (name) => addReference(references, scopes, name, start, space) })
  const enter = (node: ScopeCarrier): void => openScope(scopes, node)
  const exit = (): void => closeScope(scopes)
  new Visitor({
    TSTypeReference: (node: TSTypeReference) => record(node.typeName, node.start, 'type'),
    TSTypeQuery: (node: TSTypeQuery) => record(node.exprName, node.start, 'value'),
    TSInterfaceHeritage: (node: TSInterfaceHeritage) => record(node.expression, node.start, 'type'),
    TSClassImplements: (node: TSClassImplements) => record(node.expression, node.start, 'type'),
    ClassDeclaration: (node: Class) => {
      record(node.superClass, node.start, 'value')
      enter(node)
    },
    'ClassDeclaration:exit': exit,
    ClassExpression: enter,
    'ClassExpression:exit': exit,
    FunctionDeclaration: enter,
    'FunctionDeclaration:exit': exit,
    FunctionExpression: enter,
    'FunctionExpression:exit': exit,
    ArrowFunctionExpression: enter,
    'ArrowFunctionExpression:exit': exit,
    TSDeclareFunction: enter,
    'TSDeclareFunction:exit': exit,
    TSEmptyBodyFunctionExpression: enter,
    'TSEmptyBodyFunctionExpression:exit': exit,
    TSInterfaceDeclaration: enter,
    'TSInterfaceDeclaration:exit': exit,
    TSTypeAliasDeclaration: enter,
    'TSTypeAliasDeclaration:exit': exit,
    TSMethodSignature: enter,
    'TSMethodSignature:exit': exit,
    TSCallSignatureDeclaration: enter,
    'TSCallSignatureDeclaration:exit': exit,
    TSConstructSignatureDeclaration: enter,
    'TSConstructSignatureDeclaration:exit': exit,
    TSFunctionType: enter,
    'TSFunctionType:exit': exit,
    TSConstructorType: enter,
    'TSConstructorType:exit': exit,
    TSModuleDeclaration: (node: ModuleDeclaration) => openNamespaceScope(scopes, namespacePass.pathsByStart, blocksByPath, node),
    'TSModuleDeclaration:exit': (node: ModuleDeclaration) => popNamespaceScope(scopes, node),
    TSMappedType: (node: TSMappedType) => openNamedScope(scopes, node),
    'TSMappedType:exit': exit,
    TSConditionalType: (node: TSConditionalType) => openConditional(scopes, conditionals, node),
    'TSConditionalType:exit': () => closeConditional(scopes, conditionals),
    TSInferType: (node: TSInferType) => bindInfer(conditionals, node),
  }).visit(program)
  return { references }
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
  Arr.map(referencesWithin(scan, scope, declaration), (reference) => reference.name)

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

const missingTagMessages = (graph: DeclarationGraph, entry: EntryDeclaration, item: ExportedItem): ReadonlyArray<AnalysisMessage> =>
  Arr.map(untagged(graph, item), (declaration) => analysisMessage('ae-missing-release-tag', entry.exportPath, item.namePath, declaration.declared.name))

const needsUnderscore = (maxTag: ReleaseTag, item: ExportedItem): boolean => maxTag === 'internal' && !item.namePath.includes('.')

const lacksUnderscore = (name: string): boolean => !name.startsWith('_')

const underscoreMessages = (maxTag: ReleaseTag, entry: EntryDeclaration, item: ExportedItem): ReadonlyArray<AnalysisMessage> =>
  needsUnderscore(maxTag, item)
    ? Arr.map(Arr.filter(item.exportNames, lacksUnderscore), (name) => analysisMessage('ae-internal-missing-underscore', entry.exportPath, item.namePath, name))
    : []

const allTagged = (maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): boolean => Arr.every(tags, (tag) => tag === maxTag)

const mixedTagged = (maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): boolean =>
  !allTagged(maxTag, tags) && Arr.some(tags, (tag) => tag === 'internal')

const mixedMessages = (entry: EntryDeclaration, item: ExportedItem, maxTag: ReleaseTag, tags: ReadonlyArray<ReleaseTag>): ReadonlyArray<AnalysisMessage> =>
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
  entry: EntryDeclaration,
  item: ExportedItem,
  declaration: Declaration,
  referenced: ExportedItem,
): ReadonlyArray<AnalysisMessage> =>
  morePublic(declaringTag(graph, item.file, declaration), maxTagIn(graph, referenced))
    ? [analysisMessage('ae-incompatible-release-tags', entry.exportPath, item.namePath, item.name)]
    : []

const localMessages = (
  resolution: Resolution,
  entry: EntryDeclaration,
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
  entry: EntryDeclaration,
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
  entry: EntryDeclaration,
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
  entry: EntryDeclaration,
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
  entry: EntryDeclaration,
  consumable: HashMap.HashMap<string, ExportedItem>,
  item: ExportedItem,
): ReadonlyArray<AnalysisMessage> =>
  Arr.flatMap(item.declarations, (declaration) => declarationMessages(resolution, entry, consumable, item, declaration))

const itemMessages = (
  resolution: Resolution,
  entry: EntryDeclaration,
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

const entryMessages = (resolution: Resolution, entry: EntryDeclaration): ReadonlyArray<AnalysisMessage> => {
  const consumable = mergeByKey(itemList(resolution.graph, entry.declarationFile))
  return Arr.flatMap(Arr.fromIterable(HashMap.values(consumable)), (item) => itemMessages(resolution, entry, consumable, item))
}

const messageKey = (message: AnalysisMessage): string => [message.messageId, message.entryPoint, message.item, message.symbol].join('\u0000')

const deduped = (messages: ReadonlyArray<AnalysisMessage>): ReadonlyArray<AnalysisMessage> =>
  Arr.dedupeWith(messages, (left, right) => messageKey(left) === messageKey(right))

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

export const messagesOfGraph = (graph: DeclarationGraph): Effect.Effect<ReadonlyArray<AnalysisMessage>, UnsupportedDeclaration> =>
  Effect.succeed(messagesFor(graph))

export const resolveMessages = (declarations: Declarations): Effect.Effect<ReadonlyArray<AnalysisMessage>, UnsupportedDeclaration> =>
  Effect.map(declarationGraph(declarations), messagesFor)
