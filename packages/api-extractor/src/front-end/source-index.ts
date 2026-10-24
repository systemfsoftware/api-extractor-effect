/**
 * Source-derived facts for the model: anchors, release tags and `@stability`.
 *
 * The index parses each source text the emitter read with oxc-parser, so both
 * emitter routes give the same anchor for the same package without declaration maps.
 */
import { Array as Arr, HashMap, Match, Option, Order } from 'effect'
import {
  type Class,
  type Comment,
  type Directive,
  type ExportAllDeclaration,
  type ExportDefaultDeclaration,
  type ExportNamedDeclaration,
  type Function as FunctionNode,
  type ModuleExportName,
  parseSync,
  type Program,
  type Statement,
  type TSEnumDeclaration,
  type TSGlobalDeclaration,
  type TSInterfaceDeclaration,
  type TSModuleBlock,
  type TSModuleDeclaration,
  type TSTypeAliasDeclaration,
  type VariableDeclaration,
} from 'oxc-parser'
import type { CoverageReason } from '../model/api-model.schema.ts'
import { type Anchor, type ItemMeta, NO_ITEM_META, type ReleaseTag } from '../model/anchor.schema.ts'
import { sourceCandidatesOf } from './declaration-graph.ts'
import type { SourceFile } from './declarations.schema.ts'
import { docFactsOf, leadingDocComment, precedingEnd, type SourceDocComment } from './tsdoc.ts'

const SOURCE_KINDS = ['function', 'variable', 'typeAlias', 'interface', 'class', 'enum', 'namespace'] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]

/** A declaration the source holds, at its anchor and its path inside the file's namespaces. */
export type SourceDeclaration = {
  readonly file: string
  readonly line: number
  /** The dotted path from the file's top level, e.g. `NamespaceA.list`. */
  readonly path: string
  readonly name: string
  readonly kind: SourceKind
  readonly releaseTag: ReleaseTag
  readonly stability: string | null
}

/** A re-export statement in a source file; `star` marks `export * from`. */
export type SourceReExport = {
  readonly anchor: Anchor
  readonly module: string
  readonly names: ReadonlyArray<string>
  readonly star: boolean
  readonly releaseTag: ReleaseTag
  readonly stability: string | null
}

/** An ambient block in a source file. */
export type SourceAmbient = {
  readonly kind: 'global' | 'module'
  readonly module: string | null
  readonly line: number
}

export type SourceIndex = {
  readonly declarationsOf: (file: string) => ReadonlyArray<SourceDeclaration>
  readonly reExportsOf: (file: string) => ReadonlyArray<SourceReExport>
  readonly ambientOf: (file: string) => ReadonlyArray<SourceAmbient>
  /**
   * The metadata of the declaration a declaration file holds, found through its
   * source. `path` is the item's dotted path inside the file; the name alone is
   * the fallback when the path finds no declaration.
   */
  readonly metaOf: (declarationFile: string, name: string, kind: SourceKind, path: string) => ItemMeta
  /** The metadata of a `export * as name from '...'` statement in a declaration file. */
  readonly reExportMetaOf: (declarationFile: string, name: string) => ItemMeta
  /** Sources the index could not parse. */
  readonly reasons: ReadonlyArray<CoverageReason>
}

export type SourceIndexRequest = {
  readonly sources: ReadonlyArray<SourceFile>
  /** The package's path from the anchor root, joined with `/`; empty at the root. */
  readonly anchorPrefix: string
}

const byPath: Order.Order<SourceFile> = Order.mapInput(Order.String, (source: SourceFile) => source.path)

type LineCursor = { offset: number; line: number }

/** Declarations are visited in source order, so each line count only scans the text since the last one. */
const lineAt = (context: Context, offset: number): number => {
  context.cursor.line += context.text.slice(context.cursor.offset, offset).split('\n').length - 1
  context.cursor.offset = offset
  return context.cursor.line
}

const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'] as const

const isDeclarationSource = (file: string): boolean => Arr.some(DECLARATION_SUFFIXES, (suffix) => file.endsWith(suffix))

const languageOf = (file: string): 'ts' | 'tsx' | 'dts' =>
  Match.value(file).pipe(
    Match.when(isDeclarationSource, () => 'dts' as const),
    Match.when((path) => path.endsWith('.tsx'), () => 'tsx' as const),
    Match.orElse(() => 'ts' as const),
  )

const anchorFileOf = (anchorPrefix: string, file: string): string => (anchorPrefix === '' ? file : `${anchorPrefix}/${file}`)

const named = (name: string | undefined): string => Option.getOrElse(Option.fromNullishOr(name), () => 'default')

const functionName = (node: FunctionNode): string => named(node.id?.name)

const className = (node: Class): string => named(node.id?.name)

const moduleNameOf = (name: ModuleExportName): string =>
  Match.value(name).pipe(
    Match.when({ type: 'Literal' }, (literal) => literal.value),
    Match.orElse((other) => other.name),
  )

type Collected = {
  readonly declarations: Array<SourceDeclaration>
  readonly reExports: Array<SourceReExport>
  readonly ambient: Array<SourceAmbient>
}

type Context = {
  readonly anchorFile: string
  readonly text: string
  readonly comments: ReadonlyArray<SourceDocComment>
  readonly collected: Collected
  /** The namespaces the current statement sits in, outermost first. */
  readonly namePath: ReadonlyArray<string>
  readonly cursor: LineCursor
}

type StatementNode = Directive | Statement

const factsOf = (
  context: Context,
  siblings: ReadonlyArray<{ readonly end: number }>,
  at: number,
): { readonly releaseTag: ReleaseTag; readonly stability: string | null } =>
  Option.match(leadingDocComment(context.comments, precedingEnd(siblings, at), at), {
    onNone: (): { readonly releaseTag: ReleaseTag; readonly stability: string | null } => ({ releaseTag: 'untagged', stability: null }),
    onSome: (comment) => {
      const facts = docFactsOf(comment.value)
      return {
        releaseTag: Option.getOrElse(facts.releaseTag, (): ReleaseTag => 'untagged'),
        stability: Option.getOrNull(facts.stability),
      }
    },
  })

const addDeclaration = (
  context: Context,
  siblings: ReadonlyArray<{ readonly end: number }>,
  name: string,
  kind: SourceKind,
  at: number,
): void => {
  const facts = factsOf(context, siblings, at)
  void context.collected.declarations.push({
    file: context.anchorFile,
    line: lineAt(context, at),
    path: [...context.namePath, name].join('.'),
    name,
    kind,
    releaseTag: facts.releaseTag,
    stability: facts.stability,
  })
}

const recordFunction = (context: Context, siblings: ReadonlyArray<{ readonly end: number }>, node: FunctionNode): void =>
  addDeclaration(context, siblings, functionName(node), 'function', node.start)

const recordClass = (context: Context, siblings: ReadonlyArray<{ readonly end: number }>, node: Class): void =>
  addDeclaration(context, siblings, className(node), 'class', node.start)

const recordInterface = (context: Context, siblings: ReadonlyArray<{ readonly end: number }>, node: TSInterfaceDeclaration): void =>
  addDeclaration(context, siblings, node.id.name, 'interface', node.start)

const recordAlias = (context: Context, siblings: ReadonlyArray<{ readonly end: number }>, node: TSTypeAliasDeclaration): void =>
  addDeclaration(context, siblings, node.id.name, 'typeAlias', node.start)

const recordEnum = (context: Context, siblings: ReadonlyArray<{ readonly end: number }>, node: TSEnumDeclaration): void =>
  addDeclaration(context, siblings, node.id.name, 'enum', node.start)

const recordVariable = (
  context: Context,
  siblings: ReadonlyArray<{ readonly end: number }>,
  node: VariableDeclaration,
): void => {
  Arr.forEach(node.declarations, (declarator) => {
    if (declarator.id.type === 'Identifier') {
      addDeclaration(context, siblings, declarator.id.name, 'variable', declarator.start)
    }
  })
}

const recordNamedExport = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  node: ExportNamedDeclaration,
): void => {
  Option.match(Option.fromNullishOr(node.declaration), {
    onNone: () =>
      Option.match(Option.fromNullishOr(node.source), {
        onNone: () => undefined,
        onSome: (source) => {
          const facts = factsOf(context, siblings, node.start)
          void context.collected.reExports.push({
            anchor: { file: context.anchorFile, line: lineAt(context, node.start) },
            module: source.value,
            names: node.specifiers.map((specifier) => moduleNameOf(specifier.exported)),
            star: false,
            releaseTag: facts.releaseTag,
            stability: facts.stability,
          })
        },
      }),
    onSome: (declaration) => recordStatement(context, siblings, declaration),
  })
}

const recordStarExport = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  node: ExportAllDeclaration,
): void => {
  const names = Option.match(Option.fromNullishOr(node.exported), {
    onNone: () => Arr.empty<string>(),
    onSome: (exported) => [moduleNameOf(exported)],
  })
  const facts = factsOf(context, siblings, node.start)
  void context.collected.reExports.push({
    anchor: { file: context.anchorFile, line: lineAt(context, node.start) },
    module: node.source.value,
    names,
    star: node.exported === null,
    releaseTag: facts.releaseTag,
    stability: facts.stability,
  })
}

const recordDefaultExport = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  node: ExportDefaultDeclaration,
): void =>
  Match.value(node.declaration).pipe(
    Match.when(
      { type: Match.is('FunctionDeclaration', 'TSDeclareFunction') },
      (declaration: FunctionNode) => recordFunction(context, siblings, declaration),
    ),
    Match.when({ type: 'ClassDeclaration' }, (declaration: Class) => recordClass(context, siblings, declaration)),
    Match.when({ type: 'TSInterfaceDeclaration' }, (declaration: TSInterfaceDeclaration) => recordInterface(context, siblings, declaration)),
    Match.orElse(() => undefined),
  )

const recordAmbient = (context: Context, kind: 'global' | 'module', module: string | null, at: number): void => {
  void context.collected.ambient.push({ kind, module, line: lineAt(context, at) })
}

const recordBlock = (context: Context, body: TSModuleBlock | TSModuleDeclaration | null): void => {
  Match.value(body).pipe(
    Match.when({ type: 'TSModuleBlock' }, (block: TSModuleBlock) =>
      Arr.forEach(block.body, (statement) => recordStatement(context, block.body, statement))),
    Match.orElse(() => undefined),
  )
}

const recordModuleId = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  node: TSModuleDeclaration,
): void =>
  Match.value(node.id).pipe(
    Match.when({ type: 'Identifier' }, (id) => {
      addDeclaration(context, siblings, id.name, 'namespace', node.start)
      recordBlock({ ...context, namePath: [...context.namePath, id.name] }, node.body)
    }),
    Match.when({ type: 'Literal' }, (id) => recordAmbient(context, 'module', id.value, node.start)),
    Match.orElse(() => undefined),
  )

const recordModule = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  node: TSModuleDeclaration | TSGlobalDeclaration,
): void => (node.global ? recordAmbient(context, 'global', null, node.start) : recordModuleId(context, siblings, node))

const recordStatement = (
  context: Context,
  siblings: ReadonlyArray<StatementNode>,
  statement: StatementNode,
): void => {
  void Match.value(statement).pipe(
    Match.discriminators('type')({
      ExportNamedDeclaration: (node) => recordNamedExport(context, siblings, node),
      ExportAllDeclaration: (node) => recordStarExport(context, siblings, node),
      ExportDefaultDeclaration: (node) => recordDefaultExport(context, siblings, node),
      VariableDeclaration: (node) => recordVariable(context, siblings, node),
      TSModuleDeclaration: (node) => recordModule(context, siblings, node),
      FunctionDeclaration: (node) => recordFunction(context, siblings, node),
      TSDeclareFunction: (node) => recordFunction(context, siblings, node),
      ClassDeclaration: (node) => recordClass(context, siblings, node),
      TSInterfaceDeclaration: (node) => recordInterface(context, siblings, node),
      TSTypeAliasDeclaration: (node) => recordAlias(context, siblings, node),
      TSEnumDeclaration: (node) => recordEnum(context, siblings, node),
    }),
    Match.orElse(() => undefined),
  )
}

type ParsedSource = {
  readonly path: string
  readonly declarations: ReadonlyArray<SourceDeclaration>
  readonly reExports: ReadonlyArray<SourceReExport>
  readonly ambient: ReadonlyArray<SourceAmbient>
  readonly reasons: ReadonlyArray<CoverageReason>
}

const parseFailure = (file: string, message: string): CoverageReason => ({
  kind: 'parse',
  file,
  detail: `the source file could not be parsed (${message})`,
})

const collectSource = (file: SourceFile, anchorPrefix: string, program: Program, comments: ReadonlyArray<Comment>): ParsedSource => {
  const collected: Collected = { declarations: [], reExports: [], ambient: [] }
  const context: Context = {
    anchorFile: anchorFileOf(anchorPrefix, file.path),
    text: file.text,
    comments: comments.map((comment) => ({ type: comment.type, value: comment.value, start: comment.start, end: comment.end })),
    collected,
    namePath: [],
    cursor: { offset: 0, line: 1 },
  }
  Arr.forEach(program.body, (statement) => recordStatement(context, program.body, statement))
  return { path: file.path, ...collected, reasons: [] }
}

const indexSource = (file: SourceFile, anchorPrefix: string): ParsedSource => {
  const result = parseSync(file.path, file.text, { lang: languageOf(file.path), sourceType: 'module' })
  return Arr.match(result.errors, {
    onEmpty: () => collectSource(file, anchorPrefix, result.program, result.comments),
    onNonEmpty: (errors) => ({
      path: file.path,
      declarations: [],
      reExports: [],
      ambient: [],
      reasons: errors.map((error) => parseFailure(file.path, error.message)),
    }),
  })
}

const sourceFileOf = (
  sources: HashMap.HashMap<string, ParsedSource>,
  declarationFile: string,
): Option.Option<string> =>
  Arr.findFirst([declarationFile, ...sourceCandidatesOf(declarationFile)], (candidate) => HashMap.has(sources, candidate))

const declarationIn = (
  declarations: ReadonlyArray<SourceDeclaration>,
  name: string,
  kind: SourceKind,
  path: string,
): Option.Option<SourceDeclaration> =>
  Option.orElse(
    Arr.findFirst(declarations, (declaration) => declaration.kind === kind && declaration.path === path),
    () => Option.orElse(
      Arr.findFirst(declarations, (declaration) => declaration.path === path),
      () => Option.orElse(
        Arr.findFirst(declarations, (declaration) => declaration.kind === kind && declaration.name === name),
        () => Arr.findFirst(declarations, (declaration) => declaration.name === name),
      ),
    ),
  )

/** An index over nothing: every item is unanchored and untagged, as the synthetic builder path declares. */
export const emptySourceIndex: SourceIndex = {
  declarationsOf: () => [],
  reExportsOf: () => [],
  ambientOf: () => [],
  metaOf: () => NO_ITEM_META,
  reExportMetaOf: () => NO_ITEM_META,
  reasons: [],
}

export const sourceIndexOf = (request: SourceIndexRequest): SourceIndex => {
  const parsed = Arr.sort(request.sources, byPath).map((source) => indexSource(source, request.anchorPrefix))
  const sources = HashMap.fromIterable(parsed.map((source) => [source.path, source] as const))
  const parsedAt = (file: string): Option.Option<ParsedSource> => HashMap.get(sources, file)
  const declarationsOf = (file: string): ReadonlyArray<SourceDeclaration> =>
    Option.match(parsedAt(file), { onNone: () => [], onSome: (source) => source.declarations })
  const reExportsOf = (file: string): ReadonlyArray<SourceReExport> =>
    Option.match(parsedAt(file), { onNone: () => [], onSome: (source) => source.reExports })
  const ambientOf = (file: string): ReadonlyArray<SourceAmbient> =>
    Option.match(parsedAt(file), { onNone: () => [], onSome: (source) => source.ambient })
  const metaOfDeclaration = (declaration: SourceDeclaration): ItemMeta => ({
    anchor: { file: declaration.file, line: declaration.line },
    releaseTag: declaration.releaseTag,
    stability: declaration.stability,
  })
  const metaOf = (declarationFile: string, name: string, kind: SourceKind, path: string): ItemMeta =>
    Option.match(Option.flatMap(sourceFileOf(sources, declarationFile), parsedAt), {
      onNone: () => NO_ITEM_META,
      onSome: (source) =>
        Option.match(declarationIn(source.declarations, name, kind, path), {
          onNone: () => NO_ITEM_META,
          onSome: metaOfDeclaration,
        }),
    })
  const reExportMetaOf = (declarationFile: string, name: string): ItemMeta =>
    Option.match(Option.flatMap(sourceFileOf(sources, declarationFile), parsedAt), {
      onNone: () => NO_ITEM_META,
      onSome: (source) =>
        Option.match(Arr.findFirst(source.reExports, (record) => Arr.some(record.names, (exported) => exported === name)), {
          onNone: () => NO_ITEM_META,
          onSome: (record) => ({ anchor: record.anchor, releaseTag: record.releaseTag, stability: record.stability }),
        }),
    })
  return {
    declarationsOf,
    reExportsOf,
    ambientOf,
    metaOf,
    reExportMetaOf,
    reasons: Arr.flatMap(parsed, (source) => source.reasons),
  }
}
