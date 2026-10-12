import { Array as Arr, Effect, Function as Fn, HashMap, HashSet, Match, Option, Order } from 'effect'
import {
  type Class,
  type Comment,
  type Declaration as DeclarationNode,
  type Directive,
  type ExportDefaultDeclaration,
  type ExportNamedDeclaration,
  type Function as FunctionNode,
  type ImportDeclaration,
  type ImportDeclarationSpecifier,
  type ModuleExportName,
  parseSync,
  type Program,
  type Statement,
  type TSEnumDeclaration,
  type TSInterfaceDeclaration,
  type TSModuleDeclaration,
  type TSTypeAliasDeclaration,
  type VariableDeclaration,
  type VariableDeclarator,
  Visitor,
} from 'oxc-parser'
import type { DeclarationFile, Declarations } from './declarations.schema.ts'
import { UnsupportedDeclaration } from './front-end-error.schema.ts'

const RELATIVE_SPECIFIER = /^\.\.?(\/|$)/
const SCRIPT_EXTENSION = /\.(?:d\.)?([mc]?)[tj]sx?$/
const DECLARATION_EXTENSION = /\.d\.([mc]?)ts$/

export const isRelativeSpecifier = (specifier: string): boolean => RELATIVE_SPECIFIER.test(specifier)

const directoryOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0))

const parentOf = (kept: ReadonlyArray<string>): Option.Option<ReadonlyArray<string>> =>
  Option.map(Option.liftPredicate(kept, Arr.isReadonlyArrayNonEmpty), (nonEmpty) => nonEmpty.slice(0, -1))

const stepInto = (kept: ReadonlyArray<string>, part: string): Option.Option<ReadonlyArray<string>> =>
  Match.value(part).pipe(
    Match.when('..', () => parentOf(kept)),
    Match.whenOr('.', '', () => Option.some(kept)),
    Match.orElse(() => Option.some([...kept, part])),
  )

const normalisedPath = (path: string): Option.Option<string> =>
  Option.map(
    Arr.reduce(path.split('/'), Option.some<ReadonlyArray<string>>([]), (parts, part) => Option.flatMap(parts, (kept) => stepInto(kept, part))),
    Arr.join('/'),
  )

const declarationExtensionOf = (flavour: string): string => (flavour === '' ? '.d.ts' : `.d.${flavour}ts`)

const candidatesForBase = (base: string): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(SCRIPT_EXTENSION.exec(base)), {
    onNone: () => [`${base}.d.ts`, `${base}/index.d.ts`],
    onSome: (extension) => [base.slice(0, extension.index) + declarationExtensionOf(extension[1] ?? '')],
  })

const joinedSpecifier = (fromDeclaration: string, specifier: string): string =>
  [directoryOf(fromDeclaration), specifier].filter((part) => part !== '').join('/')

export const declarationCandidates: {
  (specifier: string): (fromDeclaration: string) => ReadonlyArray<string>
  (fromDeclaration: string, specifier: string): ReadonlyArray<string>
} = Fn.dual(2, (fromDeclaration: string, specifier: string): ReadonlyArray<string> =>
  Option.match(normalisedPath(joinedSpecifier(fromDeclaration, specifier)), { onNone: () => [], onSome: candidatesForBase }))

export const declarationPathOf = (sourceFile: string): string =>
  sourceFile.replace(/\.([mc]?)tsx?$/, (_, flavour: string) => declarationExtensionOf(flavour))

const sourcesForFlavour = (stem: string, flavour: string): ReadonlyArray<string> =>
  flavour === '' ? [`${stem}.ts`, `${stem}.tsx`] : [`${stem}.${flavour}ts`]

export const sourceCandidatesOf = (declarationFile: string): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(DECLARATION_EXTENSION.exec(declarationFile)), {
    onNone: () => [],
    onSome: (flavour) => sourcesForFlavour(declarationFile.slice(0, flavour.index), flavour[1] ?? ''),
  })

type Parsed = { readonly program: Program; readonly comments: ReadonlyArray<Comment> }

const parsed = (path: string, text: string): Effect.Effect<Parsed, UnsupportedDeclaration> => {
  const result = parseSync(path, text, { lang: 'dts', sourceType: 'module' })
  return Option.match(Arr.head(result.errors), {
    onNone: () => Effect.succeed({ program: result.program, comments: result.comments }),
    onSome: (error) => Effect.fail(new UnsupportedDeclaration({ file: path, construct: `unparseable declaration text (${error.message})` })),
  })
}

const moduleNameOf = (name: ModuleExportName): string => (name.type === 'Literal' ? name.value : name.name)

const sourceOfExport = (node: ExportNamedDeclaration): ReadonlyArray<string> => (node.source === null ? [] : [node.source.value])

export const specifiersOf = (program: Program): ReadonlyArray<string> => {
  const found: Array<string> = []
  new Visitor({
    ImportDeclaration: (node) => void found.push(node.source.value),
    ExportNamedDeclaration: (node) => void found.push(...sourceOfExport(node)),
    ExportAllDeclaration: (node) => void found.push(node.source.value),
    TSImportType: (node) => void found.push(node.source.value),
  }).visit(program)
  return found
}

type Loaded = HashMap.HashMap<string, string>

type Loader<E, R> = (declarationFile: string) => Effect.Effect<Option.Option<string>, E, R>

const loadCandidate = <E, R>(candidate: string, rest: ReadonlyArray<string>, loaded: Loaded, load: Loader<E, R>) =>
  Option.match(HashMap.get(loaded, candidate), {
    onNone: () =>
      Effect.flatMap(load(candidate), (text) =>
        Option.match(text, {
          onNone: () => firstLoaded(rest, loaded, load),
          onSome: (value) => Effect.succeedSome([candidate, value] as const),
        })),
    onSome: (known) => Effect.succeedSome([candidate, known] as const),
  })

const firstLoaded = <E, R>(
  candidates: ReadonlyArray<string>,
  loaded: Loaded,
  load: Loader<E, R>,
): Effect.Effect<Option.Option<readonly [string, string]>, E, R> =>
  Arr.match(candidates, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([candidate, ...rest]) => loadCandidate(candidate, rest, loaded, load),
  })

const followed = (file: string, program: Program): ReadonlyArray<ReadonlyArray<string>> =>
  specifiersOf(program).filter(isRelativeSpecifier).map((specifier) => declarationCandidates(file, specifier))

const visitFound = <E, R>(file: string, text: string, rest: ReadonlyArray<ReadonlyArray<string>>, loaded: Loaded, load: Loader<E, R>) =>
  HashMap.has(loaded, file)
    ? visit(rest, loaded, load)
    : Effect.flatMap(parsed(file, text), ({ program }) => visit([...rest, ...followed(file, program)], HashMap.set(loaded, file, text), load))

const visit = <E, R>(
  pending: ReadonlyArray<ReadonlyArray<string>>,
  loaded: Loaded,
  load: Loader<E, R>,
): Effect.Effect<Loaded, E | UnsupportedDeclaration, R> =>
  Arr.match(pending, {
    onEmpty: () => Effect.succeed(loaded),
    onNonEmpty: ([candidates, ...rest]) =>
      Effect.flatMap(firstLoaded(candidates, loaded, load), (found) =>
        Option.match(found, {
          onNone: () => visit(rest, loaded, load),
          onSome: ([file, text]) => visitFound(file, text, rest, loaded, load),
        })),
  })

const byPath: Order.Order<DeclarationFile> = Order.mapInput(Order.String, (file: DeclarationFile) => file.path)

export type ClosureRequest<E, R> = {
  readonly entryDeclarations: ReadonlyArray<string>
  readonly load: Loader<E, R>
}

export const closeDeclarations = <E, R>(request: ClosureRequest<E, R>): Effect.Effect<ReadonlyArray<DeclarationFile>, E | UnsupportedDeclaration, R> =>
  Effect.map(
    visit(request.entryDeclarations.map(Arr.of), HashMap.empty(), request.load),
    (loaded) => Arr.sort(Arr.map(HashMap.toEntries(loaded), ([path, text]) => ({ path, text })), byPath),
  )

export type Declared =
  | { readonly kind: 'variable'; readonly constant: boolean; readonly node: VariableDeclarator; readonly name: string }
  | { readonly kind: 'function'; readonly node: FunctionNode; readonly name: string }
  | { readonly kind: 'class'; readonly node: Class; readonly name: string }
  | { readonly kind: 'interface'; readonly node: TSInterfaceDeclaration; readonly name: string }
  | { readonly kind: 'typeAlias'; readonly node: TSTypeAliasDeclaration; readonly name: string }
  | { readonly kind: 'enum'; readonly node: TSEnumDeclaration; readonly name: string }
  | { readonly kind: 'namespace'; readonly node: TSModuleDeclaration; readonly name: string }

export type Declaration = {
  readonly declared: Declared
  readonly statementStart: number
}

export type ImportBinding = {
  readonly specifier: string
  readonly imported: string
}

export type ExportBinding =
  | { readonly kind: 'local'; readonly local: string }
  | { readonly kind: 'reexport'; readonly specifier: string; readonly imported: string }

export type FileScope = {
  readonly path: string
  readonly text: string
  readonly program: Program
  readonly comments: ReadonlyArray<Comment>
  readonly declarations: HashMap.HashMap<string, ReadonlyArray<Declaration>>
  readonly imports: HashMap.HashMap<string, ImportBinding>
  readonly exports: HashMap.HashMap<string, ExportBinding>
  readonly starExports: ReadonlyArray<string>
}

export type ResolvedSymbol =
  | { readonly kind: 'local'; readonly file: string; readonly name: string; readonly declarations: ReadonlyArray<Declaration> }
  | { readonly kind: 'namespace'; readonly file: string }
  | { readonly kind: 'external'; readonly module: string; readonly imported: string }

export type DeclarationGraph = {
  readonly files: HashMap.HashMap<string, FileScope>
  readonly entryPoints: ReadonlyArray<{ readonly exportPath: string; readonly declarationFile: string }>
}

const unsupported = (file: string, construct: string): Effect.Effect<never, UnsupportedDeclaration> =>
  Effect.fail(new UnsupportedDeclaration({ file, construct }))

type ScopeParts = {
  readonly declarations: ReadonlyArray<readonly [string, Declaration]>
  readonly imports: ReadonlyArray<readonly [string, ImportBinding]>
  readonly exports: ReadonlyArray<readonly [string, ExportBinding]>
  readonly starExports: ReadonlyArray<string>
}

const EMPTY_PARTS: ScopeParts = { declarations: [], imports: [], exports: [], starExports: [] }

type DeclaredResult = Effect.Effect<ReadonlyArray<Declared>, UnsupportedDeclaration>

const named = <A>(id: { readonly name: string } | null, declared: (name: string) => A): ReadonlyArray<A> =>
  id === null ? [] : [declared(id.name)]

const variablesOf = (node: VariableDeclaration, file: string): DeclaredResult =>
  Effect.forEach(node.declarations, (declarator) =>
    declarator.id.type === 'Identifier'
      ? Effect.succeed<Declared>({ kind: 'variable', constant: node.kind === 'const', node: declarator, name: declarator.id.name })
      : unsupported(file, 'a destructuring variable declaration'))

const namespaceOf = (node: TSModuleDeclaration, file: string): DeclaredResult =>
  Match.value(node.id).pipe(
    Match.when({ type: 'Identifier' }, (id) => Effect.succeed<ReadonlyArray<Declared>>([{ kind: 'namespace', node, name: id.name }])),
    Match.when({ type: 'Literal' }, (id) => unsupported(file, `\`declare module "${id.value}"\``)),
    Match.orElse(() => unsupported(file, 'a dotted namespace declaration')),
  )

const declaredOf = (node: DeclarationNode | Statement | ExportDefaultDeclaration['declaration'], file: string): DeclaredResult =>
  Match.value(node).pipe(
    Match.when({ type: 'VariableDeclaration' }, (variable) => variablesOf(variable, file)),
    Match.when({ type: Match.is('FunctionDeclaration', 'TSDeclareFunction') }, (fn: FunctionNode) =>
      Effect.succeed(named<Declared>(fn.id, (name) => ({ kind: 'function', node: fn, name })))),
    Match.when({ type: 'ClassDeclaration' }, (cls: Class) => Effect.succeed(named<Declared>(cls.id, (name) => ({ kind: 'class', node: cls, name })))),
    Match.when({ type: 'TSInterfaceDeclaration' }, (iface) => Effect.succeed<ReadonlyArray<Declared>>([{ kind: 'interface', node: iface, name: iface.id.name }])),
    Match.when({ type: 'TSTypeAliasDeclaration' }, (alias) => Effect.succeed<ReadonlyArray<Declared>>([{ kind: 'typeAlias', node: alias, name: alias.id.name }])),
    Match.when({ type: 'TSEnumDeclaration' }, (enumeration) =>
      Effect.succeed<ReadonlyArray<Declared>>([{ kind: 'enum', node: enumeration, name: enumeration.id.name }])),
    Match.when({ type: 'TSModuleDeclaration', global: true }, () => unsupported(file, '`declare global`')),
    Match.when({ type: 'TSModuleDeclaration', global: false }, (module: TSModuleDeclaration) => namespaceOf(module, file)),
    Match.orElse(() => Effect.succeed<ReadonlyArray<Declared>>([])),
  )

const declarationsPart = (declared: ReadonlyArray<Declared>, statementStart: number): ScopeParts => ({
  ...EMPTY_PARTS,
  declarations: declared.map((item) => [item.name, { declared: item, statementStart }] as const),
})

const importedNameOf = (specifier: ImportDeclarationSpecifier): string =>
  Match.value(specifier).pipe(
    Match.discriminatorsExhaustive('type')({
      ImportSpecifier: (named) => moduleNameOf(named.imported),
      ImportNamespaceSpecifier: () => '*',
      ImportDefaultSpecifier: () => 'default',
    }),
  )

const importParts = (statement: ImportDeclaration): ScopeParts => ({
  ...EMPTY_PARTS,
  imports: statement.specifiers.map((specifier) => [specifier.local.name, { specifier: statement.source.value, imported: importedNameOf(specifier) }] as const),
})

const exportBindingOf = (statement: ExportNamedDeclaration, local: string): ExportBinding =>
  statement.source === null ? { kind: 'local', local } : { kind: 'reexport', specifier: statement.source.value, imported: local }

const exportListParts = (statement: ExportNamedDeclaration): ScopeParts => ({
  ...EMPTY_PARTS,
  exports: statement.specifiers.map((specifier) => [moduleNameOf(specifier.exported), exportBindingOf(statement, moduleNameOf(specifier.local))] as const),
})

const exportedDeclarationParts = (declaration: DeclarationNode, statement: ExportNamedDeclaration, file: string) =>
  Effect.map(declaredOf(declaration, file), (declared): ScopeParts => ({
    ...declarationsPart(declared, statement.start),
    exports: declared.map((item) => [item.name, { kind: 'local', local: item.name }] as const),
  }))

const exportNamedParts = (statement: ExportNamedDeclaration, file: string): Effect.Effect<ScopeParts, UnsupportedDeclaration> =>
  statement.declaration === null ? Effect.succeed(exportListParts(statement)) : exportedDeclarationParts(statement.declaration, statement, file)

const defaultExportOf = (declared: ReadonlyArray<Declared>, statementStart: number): ScopeParts =>
  Option.match(Arr.head(declared), {
    onNone: () => EMPTY_PARTS,
    onSome: (first) => ({ ...declarationsPart(declared, statementStart), exports: [['default', { kind: 'local', local: first.name }]] }),
  })

const exportDefaultParts = (statement: ExportDefaultDeclaration, file: string): Effect.Effect<ScopeParts, UnsupportedDeclaration> =>
  Match.value(statement.declaration).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Effect.succeed<ScopeParts>({ ...EMPTY_PARTS, exports: [['default', { kind: 'local', local: identifier.name }]] })),
    Match.whenOr(
      { type: 'FunctionDeclaration' },
      { type: 'TSDeclareFunction' },
      { type: 'ClassDeclaration' },
      { type: 'TSInterfaceDeclaration' },
      (declaration) => Effect.map(declaredOf(declaration, file), (declared) => defaultExportOf(declared, statement.start)),
    ),
    Match.orElse(() => unsupported(file, '`export default` of an expression')),
  )

const statementParts = (statement: Directive | Statement, file: string): Effect.Effect<ScopeParts, UnsupportedDeclaration> =>
  Match.value(statement).pipe(
    Match.discriminators('type')({
      ImportDeclaration: (node) => Effect.succeed(importParts(node)),
      ExportNamedDeclaration: (node) => exportNamedParts(node, file),
      ExportAllDeclaration: (node) =>
        Effect.succeed<ScopeParts>(
          node.exported === null
            ? { ...EMPTY_PARTS, starExports: [node.source.value] }
            : { ...EMPTY_PARTS, exports: [[moduleNameOf(node.exported), { kind: 'reexport', specifier: node.source.value, imported: '*' }]] },
        ),
      ExportDefaultDeclaration: (node) => exportDefaultParts(node, file),
      TSExportAssignment: () => unsupported(file, '`export =`'),
      TSImportEqualsDeclaration: () => unsupported(file, '`import =`'),
      TSNamespaceExportDeclaration: () => unsupported(file, '`export as namespace`'),
    }),
    Match.orElse((node) => Effect.map(declaredOf(node, file), (declared) => declarationsPart(declared, node.start))),
  )

const grouped = <A>(entries: ReadonlyArray<readonly [string, A]>): HashMap.HashMap<string, ReadonlyArray<A>> =>
  Arr.reduce(entries, HashMap.empty<string, ReadonlyArray<A>>(), (groups, [key, value]) =>
    HashMap.set(groups, key, [...Option.getOrElse(HashMap.get(groups, key), (): ReadonlyArray<A> => []), value]))

const isEmptyExportList = (node: ExportNamedDeclaration): boolean => node.declaration === null && node.specifiers.length === 0

const isExportBlocker = (statement: Directive | Statement): boolean =>
  Match.value(statement).pipe(
    Match.when({ type: 'ExportNamedDeclaration' }, isEmptyExportList),
    Match.orElse(() => false),
  )

const implicitExports = (program: Program, parts: ReadonlyArray<ScopeParts>): ReadonlyArray<readonly [string, ExportBinding]> =>
  program.body.some(isExportBlocker)
    ? []
    : parts.flatMap((part) => part.declarations.map(([name]) => [name, { kind: 'local', local: name }] as const))

const scopeOf = (file: DeclarationFile): Effect.Effect<FileScope, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const { program, comments } = yield* parsed(file.path, file.text)
    const parts = yield* Effect.forEach(program.body, (statement) => statementParts(statement, file.path))
    return {
      path: file.path,
      text: file.text,
      program,
      comments,
      declarations: grouped(parts.flatMap((part) => part.declarations)),
      imports: HashMap.fromIterable(parts.flatMap((part) => part.imports)),
      exports: HashMap.fromIterable([...implicitExports(program, parts), ...parts.flatMap((part) => part.exports)]),
      starExports: parts.flatMap((part) => part.starExports),
    }
  })

export const declarationGraph = (declarations: Declarations): Effect.Effect<DeclarationGraph, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(declarations.files, scopeOf), (scopes) => ({
    files: HashMap.fromIterable(scopes.map((scope) => [scope.path, scope] as const)),
    entryPoints: declarations.entryPoints,
  }))

const fileIn = (graph: DeclarationGraph, from: string, specifier: string): Option.Option<string> =>
  Arr.findFirst(declarationCandidates(from, specifier), (candidate) => HashMap.has(graph.files, candidate))

export const resolveFile: {
  (from: string, specifier: string): (graph: DeclarationGraph) => Option.Option<string>
  (graph: DeclarationGraph, from: string, specifier: string): Option.Option<string>
} = Fn.dual(3, (graph: DeclarationGraph, from: string, specifier: string): Option.Option<string> =>
  isRelativeSpecifier(specifier) ? fileIn(graph, from, specifier) : Option.none())

type Seen = HashSet.HashSet<string>

const packageImportTarget = (graph: DeclarationGraph, file: string, imported: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  imported === '*' ? Option.some({ kind: 'namespace', file }) : exportedFrom(graph, file, imported, seen)

const importTarget = (graph: DeclarationGraph, from: string, binding: ImportBinding, seen: Seen): Option.Option<ResolvedSymbol> =>
  isRelativeSpecifier(binding.specifier)
    ? Option.flatMap(fileIn(graph, from, binding.specifier), (file) => packageImportTarget(graph, file, binding.imported, seen))
    : Option.some({ kind: 'external', module: binding.specifier, imported: binding.imported })

const importedName = (graph: DeclarationGraph, scope: FileScope, name: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  Option.flatMap(HashMap.get(scope.imports, name), (binding) => importTarget(graph, scope.path, binding, seen))

const nameIn = (graph: DeclarationGraph, scope: FileScope, name: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  Option.match(HashMap.get(scope.declarations, name), {
    onNone: () => importedName(graph, scope, name, seen),
    onSome: (declarations) => Option.some({ kind: 'local', file: scope.path, name, declarations }),
  })

const resolvedIn = (graph: DeclarationGraph, file: string, name: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  Option.flatMap(HashMap.get(graph.files, file), (scope) => nameIn(graph, scope, name, seen))

export const resolveName: {
  (file: string, name: string): (graph: DeclarationGraph) => Option.Option<ResolvedSymbol>
  (graph: DeclarationGraph, file: string, name: string): Option.Option<ResolvedSymbol>
} = Fn.dual(3, (graph: DeclarationGraph, file: string, name: string) => resolvedIn(graph, file, name, HashSet.empty()))

const boundExport = (graph: DeclarationGraph, scope: FileScope, binding: ExportBinding, seen: Seen): Option.Option<ResolvedSymbol> =>
  binding.kind === 'local'
    ? nameIn(graph, scope, binding.local, seen)
    : importTarget(graph, scope.path, { specifier: binding.specifier, imported: binding.imported }, seen)

const starredExport = (graph: DeclarationGraph, scope: FileScope, name: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  name === 'default'
    ? Option.none()
    : Arr.findFirst(scope.starExports, (specifier) =>
      Option.flatMap(resolveFile(graph, scope.path, specifier), (target) => exportedFrom(graph, target, name, seen)))

const exportedFromScope = (graph: DeclarationGraph, scope: FileScope, name: string, seen: Seen): Option.Option<ResolvedSymbol> =>
  Option.match(HashMap.get(scope.exports, name), {
    onNone: () => starredExport(graph, scope, name, seen),
    onSome: (binding) => boundExport(graph, scope, binding, seen),
  })

const exportedFrom = (graph: DeclarationGraph, file: string, name: string, seen: Seen): Option.Option<ResolvedSymbol> => {
  const key = `${file}\u0000${name}`
  return HashSet.has(seen, key)
    ? Option.none()
    : Option.flatMap(HashMap.get(graph.files, file), (scope) => exportedFromScope(graph, scope, name, HashSet.add(seen, key)))
}

export const exportedSymbol: {
  (file: string, name: string): (graph: DeclarationGraph) => Option.Option<ResolvedSymbol>
  (graph: DeclarationGraph, file: string, name: string): Option.Option<ResolvedSymbol>
} = Fn.dual(3, (graph: DeclarationGraph, file: string, name: string) => exportedFrom(graph, file, name, HashSet.empty()))

const starredNames = (graph: DeclarationGraph, scope: FileScope, seen: Seen): ReadonlyArray<string> =>
  scope.starExports.flatMap((specifier) =>
    Option.match(resolveFile(graph, scope.path, specifier), {
      onNone: () => [],
      onSome: (target) => namesOf(graph, target, seen).filter((name) => name !== 'default'),
    })
  )

const scopeNames = (graph: DeclarationGraph, scope: FileScope, seen: Seen): ReadonlyArray<string> =>
  Arr.sort(Arr.dedupe([...HashMap.keys(scope.exports), ...starredNames(graph, scope, HashSet.add(seen, scope.path))]), Order.String)

const namesOf = (graph: DeclarationGraph, file: string, seen: Seen): ReadonlyArray<string> =>
  HashSet.has(seen, file)
    ? []
    : Option.match(HashMap.get(graph.files, file), { onNone: () => [], onSome: (scope) => scopeNames(graph, scope, seen) })

export const exportedNames: {
  (file: string): (graph: DeclarationGraph) => ReadonlyArray<string>
  (graph: DeclarationGraph, file: string): ReadonlyArray<string>
} = Fn.dual(2, (graph: DeclarationGraph, file: string) => namesOf(graph, file, HashSet.empty()))
