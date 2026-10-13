import { Array as Arr, Effect, HashMap, HashSet, Match, Option, Order, Ref } from 'effect'
import type {
  BindingIdentifier,
  BindingPattern,
  Class,
  Declaration as DeclarationNode,
  Directive,
  ExportNamedDeclaration,
  Expression,
  Function as FunctionNode,
  Statement,
  StringLiteral,
  TSEnumDeclaration,
  TSEnumMember,
  TSEnumMemberName,
  TSInterfaceDeclaration,
  TSModuleBlock,
  TSModuleDeclaration,
  TSQualifiedName,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  VariableDeclarator,
} from 'oxc-parser'
import {
  API_MODEL_SCHEMA_VERSION,
  sortModel,
  type ApiItem,
  type ApiModel,
  type EntryPoint,
  type EnumMember,
  type TypeAliasItem,
} from '../model/api-model.schema.ts'
import type { Member, Signature, TypeExpr, TypeParameter } from '../model/type-expr.schema.ts'
import { ENGINE } from '../version.ts'
import { literalTextOf, type Naming, type TypeContext, typeParameterNames, TypePrinting } from './canonical-type-text.ts'
import { declarationGraph, exportedNames, exportedSymbol, type Declaration, type DeclarationGraph } from './declaration-graph.ts'
import type { Declarations } from './declarations.schema.ts'
import { UnsupportedDeclaration } from './front-end-error.schema.ts'
import { TypeExprs } from './type-expr-of.ts'

const { refuse, withTypeParameters } = TypePrinting

const { classMembersOf, heritageOf, membersOf, referenceToExpression, signatureOf, typeExprOf, typeParametersOf } = TypeExprs

type LocalDeclaration = {
  readonly key: string
  readonly file: string
  readonly name: string
  readonly declarations: ReadonlyArray<Declaration>
}

type VariableEntry = { readonly constant: boolean; readonly node: VariableDeclarator }
type EntryFile = { readonly exportPath: string; readonly declarationFile: string }

const KEY_DELIMITER = '\u0000'

const localKey = (file: string, name: string): string => `${KEY_DELIMITER}${file}${KEY_DELIMITER}${name}${KEY_DELIMITER}`

const localKeyParts = (key: string): ReadonlyArray<string> => key.split(KEY_DELIMITER)

const localKeyFile = (key: string): string => Option.getOrElse(Arr.get(localKeyParts(key), 1), () => '')

const localKeyName = (key: string): string => Option.getOrElse(Arr.get(localKeyParts(key), 2), () => '')

const keyOrder: Order.Order<string> = Order.combineAll([
  Order.mapInput(Order.String, localKeyFile),
  Order.mapInput(Order.String, localKeyName),
])

const nameCandidate = (base: string, attempt: number): string => (attempt === 1 ? base : `${base}_${attempt}`)

const freeName = (base: string, attempt: number, used: HashSet.HashSet<string>): string =>
  HashSet.has(used, nameCandidate(base, attempt)) ? freeName(base, attempt + 1, used) : nameCandidate(base, attempt)

type NameAssignment = { readonly assigned: HashMap.HashMap<string, string>; readonly used: HashSet.HashSet<string> }

const assignNames = (exported: ReadonlyArray<string>, reachable: HashMap.HashMap<string, LocalDeclaration>): HashMap.HashMap<string, string> =>
  Arr.reduce<string, NameAssignment>(
    Arr.sort(HashMap.keys(reachable), keyOrder),
    { assigned: HashMap.empty(), used: HashSet.fromIterable(exported) },
    (state, key) => {
      const name = freeName(localKeyName(key), 1, state.used)
      return { assigned: HashMap.set(state.assigned, key, name), used: HashSet.add(state.used, name) }
    },
  ).assigned

const replaceNames = (text: string, rename: HashMap.HashMap<string, string>): string =>
  Arr.reduce(HashMap.toEntries(rename), text, (accumulated, [key, name]) => accumulated.replaceAll(key, () => name))

const constraintField = (parameter: TypeParameter, rename: HashMap.HashMap<string, string>): Pick<TypeParameter, 'constraint'> =>
  Option.match(Option.fromNullishOr(parameter.constraint), { onNone: () => ({}), onSome: (constraint) => ({ constraint: renameType(constraint, rename) }) })

const defaultField = (parameter: TypeParameter, rename: HashMap.HashMap<string, string>): Pick<TypeParameter, 'default'> =>
  Option.match(Option.fromNullishOr(parameter.default), { onNone: () => ({}), onSome: (fallback) => ({ default: renameType(fallback, rename) }) })

const renameTypeParameter = (parameter: TypeParameter, rename: HashMap.HashMap<string, string>): TypeParameter => ({
  name: parameter.name,
  ...constraintField(parameter, rename),
  ...defaultField(parameter, rename),
})

const renameSignature = (signature: Signature, rename: HashMap.HashMap<string, string>): Signature => ({
  typeParameters: signature.typeParameters.map((parameter) => renameTypeParameter(parameter, rename)),
  parameters: signature.parameters.map((parameter) => ({ ...parameter, type: renameType(parameter.type, rename) })),
  returns: renameType(signature.returns, rename),
})

const renameMember = (member: Member, rename: HashMap.HashMap<string, string>): Member =>
  Match.value(member).pipe(
    Match.when({ kind: 'property' }, (property) => ({ ...property, type: renameType(property.type, rename) })),
    Match.when({ kind: 'method' }, (method) => ({ ...method, signatures: method.signatures.map((signature) => renameSignature(signature, rename)) })),
    Match.when({ kind: 'call' }, (call) => ({ kind: 'call' as const, signature: renameSignature(call.signature, rename) })),
    Match.exhaustive,
  )

const renameReference = (reference: TypeExpr & { readonly kind: 'reference' }, rename: HashMap.HashMap<string, string>): TypeExpr => {
  const args = reference.args.map((argument) => renameType(argument, rename))
  return Option.match(Option.fromNullishOr(reference.module), {
    onSome: () => ({ ...reference, args }),
    onNone: () => ({ ...reference, name: Option.getOrElse(HashMap.get(rename, reference.name), () => reference.name), args }),
  })
}

const renameType = (type: TypeExpr, rename: HashMap.HashMap<string, string>): TypeExpr =>
  Match.value(type).pipe(
    Match.when({ kind: 'reference' }, (reference) => renameReference(reference, rename)),
    Match.when({ kind: 'union' }, (union) => ({ ...union, members: union.members.map((member) => renameType(member, rename)) })),
    Match.when({ kind: 'intersection' }, (intersection) => ({ ...intersection, members: intersection.members.map((member) => renameType(member, rename)) })),
    Match.when({ kind: 'array' }, (array) => ({ ...array, element: renameType(array.element, rename) })),
    Match.when({ kind: 'tuple' }, (tuple) => ({ ...tuple, elements: tuple.elements.map((element) => renameType(element, rename)) })),
    Match.when({ kind: 'function' }, (function_) => ({ kind: 'function' as const, signature: renameSignature(function_.signature, rename) })),
    Match.when({ kind: 'object' }, (object) => ({ kind: 'object' as const, members: object.members.map((member) => renameMember(member, rename)) })),
    Match.when({ kind: 'text' }, (text) => ({ kind: 'text' as const, text: replaceNames(text.text, rename) })),
    Match.when({ kind: 'keyword' }, (keyword) => keyword),
    Match.when({ kind: 'literal' }, (literal) => literal),
    Match.exhaustive,
  )

const renameAlias = (alias: TypeAliasItem, rename: HashMap.HashMap<string, string>): TypeAliasItem => ({
  kind: 'typeAlias',
  name: Option.getOrElse(HashMap.get(rename, alias.name), () => alias.name),
  typeParameters: alias.typeParameters.map((parameter) => renameTypeParameter(parameter, rename)),
  type: renameType(alias.type, rename),
})

const renameItem = (item: ApiItem, rename: HashMap.HashMap<string, string>): ApiItem =>
  Match.value(item).pipe(
    Match.when({ kind: 'namespace' }, (namespace) => ({ ...namespace, items: namespace.items.map((nested) => renameItem(nested, rename)) })),
    Match.when({ kind: 'function' }, (function_) => ({ ...function_, signatures: function_.signatures.map((signature) => renameSignature(signature, rename)) })),
    Match.when({ kind: 'variable' }, (variable) => ({ ...variable, type: renameType(variable.type, rename) })),
    Match.when({ kind: 'typeAlias' }, (alias) => renameAlias(alias, rename)),
    Match.when({ kind: 'interface' }, (iface) => ({
      ...iface,
      typeParameters: iface.typeParameters.map((parameter) => renameTypeParameter(parameter, rename)),
      extends: iface.extends.map((extended) => renameType(extended, rename)),
      members: iface.members.map((member) => renameMember(member, rename)),
    })),
    Match.when({ kind: 'class' }, (class_) => ({
      ...class_,
      typeParameters: class_.typeParameters.map((parameter) => renameTypeParameter(parameter, rename)),
      extends: class_.extends.map((extended) => renameType(extended, rename)),
      implements: class_.implements.map((implemented) => renameType(implemented, rename)),
      members: class_.members.map((member) => renameMember(member, rename)),
    })),
    Match.when({ kind: 'enum' }, (enumeration) => enumeration),
    Match.exhaustive,
  )

const addExportedName = (index: HashMap.HashMap<string, string>, key: string, name: string): HashMap.HashMap<string, string> =>
  HashMap.has(index, key) ? index : HashMap.set(index, key, name)

const reverseIndex = (graph: DeclarationGraph, file: string, exported: ReadonlyArray<string>): HashMap.HashMap<string, string> =>
  Arr.reduce(exported, HashMap.empty<string, string>(), (index, name) =>
    Option.match(exportedSymbol(graph, file, name), {
      onNone: () => index,
      onSome: (symbol) =>
        Match.value(symbol).pipe(
          Match.when({ kind: 'local' }, (local) => addExportedName(index, localKey(local.file, local.name), name)),
          Match.orElse(() => index),
        ),
    }))

const declaresTypeAlias = (declarations: ReadonlyArray<Declaration>): boolean =>
  Arr.some(declarations, (declaration) => declaration.declared.kind === 'typeAlias')

const recordLocal = (
  reachable: Ref.Ref<HashMap.HashMap<string, LocalDeclaration>>,
  file: string,
  name: string,
  declarations: ReadonlyArray<Declaration>,
): Effect.Effect<string> =>
  Effect.as(
    Ref.update(reachable, (known): HashMap.HashMap<string, LocalDeclaration> =>
      HashMap.set(known, localKey(file, name), { key: localKey(file, name), file, name, declarations })),
    localKey(file, name),
  )

const localNameOf = (
  reachable: Ref.Ref<HashMap.HashMap<string, LocalDeclaration>>,
  exported: HashMap.HashMap<string, string>,
  file: string,
  name: string,
  declarations: ReadonlyArray<Declaration>,
): Effect.Effect<string> =>
  Option.match(HashMap.get(exported, localKey(file, name)), {
    onNone: () => recordLocal(reachable, file, name, declarations),
    onSome: (exportName) => Effect.succeed(exportName),
  })

const functionsIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<FunctionNode> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'function' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const interfacesIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<TSInterfaceDeclaration> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'interface' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const classesIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<Class> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'class' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const typeAliasesIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<TSTypeAliasDeclaration> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'typeAlias' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const variablesIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<VariableEntry> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'variable' }, (declared) => Option.some({ constant: declared.constant, node: declared.node })),
        Match.orElse(() => Option.none()),
      )),
  )

const enumsIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<TSEnumDeclaration> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'enum' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const namespacesIn = (declarations: ReadonlyArray<Declaration>): ReadonlyArray<TSModuleDeclaration> =>
  Arr.getSomes(
    declarations.map((declaration) =>
      Match.value(declaration.declared).pipe(
        Match.when({ kind: 'namespace' }, (declared) => Option.some(declared.node)),
        Match.orElse(() => Option.none()),
      )),
  )

const typeAliasItem = (context: TypeContext, node: TSTypeAliasDeclaration, name: string): Effect.Effect<TypeAliasItem, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const inner = withTypeParameters(context, typeParameterNames(node.typeParameters))
    const typeParameters = yield* typeParametersOf(inner, node.typeParameters)
    const type = yield* typeExprOf(inner, node.typeAnnotation)
    return { kind: 'typeAlias', name, typeParameters, type }
  })

const declarationSignatureOf = (context: TypeContext, node: FunctionNode) =>
  signatureOf(context, node.typeParameters, node.params, node.returnType)

const functionItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<FunctionNode>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: (present) =>
      Effect.asSome(
        Effect.map(Effect.forEach(present, (node) => declarationSignatureOf(context, node)), (signatures): ApiItem => ({
          kind: 'function',
          name,
          signatures,
        })),
      ),
  })

const interfaceItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<TSInterfaceDeclaration>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: (present) =>
      Effect.asSome(
        Effect.gen(function* () {
          const first = Arr.headNonEmpty(present)
          const inner = withTypeParameters(context, typeParameterNames(first.typeParameters))
          const typeParameters = yield* typeParametersOf(inner, first.typeParameters)
          const extending = yield* Effect.forEach(present, (node) => Effect.forEach(node.extends, (heritage) => heritageOf(inner, heritage)))
          const members = yield* Effect.forEach(present, (node) => membersOf(inner, node.body.body))
          const item: ApiItem = { kind: 'interface', name, typeParameters, extends: extending.flat(), members: members.flat() }
          return item
        }),
      ),
  })

const implementedClauses = (context: TypeContext, node: Class) =>
  Effect.forEach(node.implements ?? [], (clause) => heritageOf(context, clause))

const extendsOf = (context: TypeContext, node: Class): Effect.Effect<ReadonlyArray<TypeExpr>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(node.superClass), {
    onNone: () => Effect.succeed<ReadonlyArray<TypeExpr>>([]),
    onSome: (superClass) => Effect.map(referenceToExpression(context, superClass, node.superTypeArguments), (extended) => [extended]),
  })

const classItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<Class>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([node]) =>
      Effect.asSome(
        Effect.gen(function* () {
          const inner = withTypeParameters(context, typeParameterNames(node.typeParameters))
          const typeParameters = yield* typeParametersOf(inner, node.typeParameters)
          const extended = yield* extendsOf(inner, node)
          const implemented = yield* implementedClauses(inner, node)
          const members = yield* classMembersOf(inner, node.body.body)
          const item: ApiItem = {
            kind: 'class',
            name,
            abstract: node.abstract ?? false,
            typeParameters,
            extends: extended,
            implements: implemented,
            members,
          }
          return item
        }),
      ),
  })

const typeAliasItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<TSTypeAliasDeclaration>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([node]) => Effect.asSome(typeAliasItem(context, node, name)),
  })

const declaredAnnotation = (pattern: BindingPattern): Option.Option<TSTypeAnnotation> =>
  Match.value(pattern).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.fromNullishOr(identifier.typeAnnotation)),
    Match.orElse(() => Option.none()),
  )

const variableType = (context: TypeContext, declarator: VariableDeclarator): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Option.match(declaredAnnotation(declarator.id), {
    onSome: (annotation) => typeExprOf(context, annotation.typeAnnotation),
    onNone: () =>
      Option.match(Option.fromNullishOr(declarator.init), {
        onNone: () => refuse(context.file, 'a variable declaration without a type'),
        onSome: (value) =>
          Option.match(literalTextOf(value), {
            onNone: () => refuse(context.file, 'a variable initialiser that is not a literal'),
            onSome: (text) => Effect.succeed<TypeExpr>({ kind: 'literal', text }),
          }),
      }),
  })

const variableItemOf = (
  context: TypeContext,
  entries: ReadonlyArray<VariableEntry>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(entries, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([variable]) =>
      Effect.asSome(
        Effect.map(variableType(context, variable.node), (type): ApiItem => ({ kind: 'variable', name, constant: variable.constant, type })),
      ),
  })

const enumMemberNameOf = (context: TypeContext, id: TSEnumMemberName): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(id).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Effect.succeed(identifier.name)),
    Match.when({ type: 'Literal', value: Match.string }, (literal) => Effect.succeed(literal.value)),
    Match.orElse(() => refuse(context.file, `a ${id.type} enum member name`)),
  )

const memberValue = (context: TypeContext, name: string, initializer: Expression | null): Effect.Effect<Pick<EnumMember, 'value'>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(initializer), {
    onNone: () => Effect.succeed({}),
    onSome: (expression) =>
      Option.match(literalTextOf(expression), {
        onNone: () => refuse(context.file, `enum member \`${name}\` with a computed value`),
        onSome: (value) => Effect.succeed({ value }),
      }),
  })

const enumMemberOf = (context: TypeContext, member: TSEnumMember): Effect.Effect<EnumMember, UnsupportedDeclaration> =>
  Effect.flatMap(enumMemberNameOf(context, member.id), (name) =>
    Effect.map(memberValue(context, name, member.initializer), (value): EnumMember => ({ name, ...value })))

const enumItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<TSEnumDeclaration>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([node]) =>
      Effect.asSome(
        Effect.map(
          Effect.forEach(node.body.members, (member) => enumMemberOf(context, member)),
          (members): ApiItem => ({ kind: 'enum', name, const: node.const, members }),
        ),
      ),
  })

const namespaceItemOf = (
  context: TypeContext,
  nodes: ReadonlyArray<TSModuleDeclaration>,
  name: string,
): Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration> =>
  Arr.match(nodes, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([node]) =>
      Effect.asSome(Effect.map(namespaceBodyItems(context, node.body), (items): ApiItem => ({ kind: 'namespace', name, items }))),
  })

const namespaceBodyItems = (context: TypeContext, body: TSModuleBlock | null): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(body), {
    onNone: () => Effect.succeed<ReadonlyArray<ApiItem>>([]),
    onSome: (block) => Effect.map(Effect.forEach(block.body, (statement) => statementItems(context, statement)), (items) => items.flat()),
  })

const moduleName = (id: BindingIdentifier | StringLiteral | TSQualifiedName): Option.Option<string> =>
  Match.value(id).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.some(identifier.name)),
    Match.orElse(() => Option.none()),
  )

const declaredStatementItems = (context: TypeContext, node: DeclarationNode | Statement): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Match.value(node).pipe(
    Match.when({ type: 'VariableDeclaration' }, (variable) =>
      Effect.map(
        Effect.forEach(variable.declarations, (declarator) => declaratorStatementItems(context, declarator, variable.kind === 'const')),
        (items) => items.flat(),
      )),
    Match.when({ type: Match.is('FunctionDeclaration', 'TSDeclareFunction') }, (function_) =>
      namedStatementItems(function_.id, (name) => functionItemOf(context, [function_], name))),
    Match.when({ type: 'ClassDeclaration' }, (class_) => namedStatementItems(class_.id, (name) => classItemOf(context, [class_], name))),
    Match.when({ type: 'TSInterfaceDeclaration' }, (iface) => optionalItems(interfaceItemOf(context, [iface], iface.id.name))),
    Match.when({ type: 'TSTypeAliasDeclaration' }, (alias) => optionalItems(typeAliasItemOf(context, [alias], alias.id.name))),
    Match.when({ type: 'TSEnumDeclaration' }, (enumeration) => optionalItems(enumItemOf(context, [enumeration], enumeration.id.name))),
    Match.when({ type: 'TSModuleDeclaration', global: false }, (module) => namespaceStatementItems(context, module)),
    Match.orElse(() => Effect.succeed<ReadonlyArray<ApiItem>>([])),
  )

const statementItems = (context: TypeContext, statement: Directive | Statement): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Match.value(statement).pipe(
    Match.when({ type: 'ExportNamedDeclaration' }, (declaration) => exportedStatementItems(context, declaration)),
    Match.when({ type: 'TSModuleDeclaration', global: false }, (module) => namespaceStatementItems(context, module)),
    Match.when({ type: Match.is('VariableDeclaration', 'FunctionDeclaration', 'TSDeclareFunction', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration') }, (node) =>
      declaredStatementItems(context, node)),
    Match.orElse(() => Effect.succeed<ReadonlyArray<ApiItem>>([])),
  )

const exportedStatementItems = (context: TypeContext, declaration: ExportNamedDeclaration): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(declaration.declaration), {
    onNone: () => Effect.succeed<ReadonlyArray<ApiItem>>([]),
    onSome: (inner) => declaredStatementItems(context, inner),
  })

const declaratorStatementItems = (context: TypeContext, declarator: VariableDeclarator, constant: boolean): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(
    Match.value(declarator.id).pipe(
      Match.when({ type: 'Identifier' }, (identifier) => Option.some(identifier.name)),
      Match.orElse(() => Option.none()),
    ),
    {
      onNone: () => Effect.succeed<ReadonlyArray<ApiItem>>([]),
      onSome: (name) => optionalItems(variableItemOf(context, [{ constant, node: declarator }], name)),
    },
  )

const namedStatementItems = (
  id: BindingIdentifier | null,
  build: (name: string) => Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration>,
): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(id), {
    onNone: () => Effect.succeed<ReadonlyArray<ApiItem>>([]),
    onSome: (identifier) => optionalItems(build(identifier.name)),
  })

const namespaceStatementItems = (context: TypeContext, module: TSModuleDeclaration): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(moduleName(module.id), {
    onNone: () => refuse(context.file, `a ${module.id.type} namespace name`),
    onSome: (name) => optionalItems(namespaceItemOf(context, [module], name)),
  })

const optionalItems = (item: Effect.Effect<Option.Option<ApiItem>, UnsupportedDeclaration>): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Effect.map(item, (built) => Option.match(built, { onNone: () => [], onSome: (value) => [value] }))

const itemsOfDeclarations = (context: TypeContext, declarations: ReadonlyArray<Declaration>, name: string): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Effect.map(
    Effect.all([
      functionItemOf(context, functionsIn(declarations), name),
      interfaceItemOf(context, interfacesIn(declarations), name),
      classItemOf(context, classesIn(declarations), name),
      typeAliasItemOf(context, typeAliasesIn(declarations), name),
      variableItemOf(context, variablesIn(declarations), name),
      enumItemOf(context, enumsIn(declarations), name),
      namespaceItemOf(context, namespacesIn(declarations), name),
    ]),
    Arr.getSomes,
  )

const itemsForFile = (
  graph: DeclarationGraph,
  contextFor: (file: string) => TypeContext,
  file: string,
  visited: HashSet.HashSet<string>,
): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  HashSet.has(visited, file)
    ? Effect.succeed<ReadonlyArray<ApiItem>>([])
    : Effect.map(
        Effect.forEach(exportedNames(graph, file), (name) => itemsForExport(graph, contextFor, file, name, HashSet.add(visited, file))),
        (items) => items.flat(),
      )

const itemsForExport = (
  graph: DeclarationGraph,
  contextFor: (file: string) => TypeContext,
  entryFile: string,
  name: string,
  visited: HashSet.HashSet<string>,
): Effect.Effect<ReadonlyArray<ApiItem>, UnsupportedDeclaration> =>
  Option.match(exportedSymbol(graph, entryFile, name), {
    onNone: () => Effect.succeed<ReadonlyArray<ApiItem>>([]),
    onSome: (symbol) =>
      Match.value(symbol).pipe(
        Match.when({ kind: 'external' }, (external) => refuse(entryFile, `re-export of "${name}" from "${external.module}"`)),
        Match.when({ kind: 'local' }, (local) => itemsOfDeclarations(contextFor(local.file), local.declarations, name)),
        Match.when({ kind: 'namespace' }, (namespace) =>
          Effect.map(itemsForFile(graph, contextFor, namespace.file, visited), (items): ReadonlyArray<ApiItem> => [{ kind: 'namespace', name, items }])),
        Match.exhaustive,
      ),
  })

const buildOneLocal = (
  contextFor: (file: string) => TypeContext,
  reachable: Ref.Ref<HashMap.HashMap<string, LocalDeclaration>>,
  built: Ref.Ref<HashMap.HashMap<string, TypeAliasItem>>,
  key: string,
): Effect.Effect<void, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const known = yield* Ref.get(reachable)
    return yield* Option.match(HashMap.get(known, key), {
      onNone: () => Effect.void,
      onSome: (local) =>
        Effect.flatMap(
          Arr.match(typeAliasesIn(local.declarations), {
            onEmpty: () => refuse(local.file, `a local "${local.name}" that is not a type alias`),
            onNonEmpty: ([node]) => typeAliasItem(contextFor(local.file), node, local.key),
          }),
          (item) => Ref.update(built, HashMap.set(key, item)),
        ),
    })
  })

const buildReachableLocals = (
  contextFor: (file: string) => TypeContext,
  reachable: Ref.Ref<HashMap.HashMap<string, LocalDeclaration>>,
  built: Ref.Ref<HashMap.HashMap<string, TypeAliasItem>>,
): Effect.Effect<void, UnsupportedDeclaration> => {
  const drain = (): Effect.Effect<void, UnsupportedDeclaration> =>
    Effect.gen(function* () {
      const known = yield* Ref.get(reachable)
      const done = yield* Ref.get(built)
      const pending = Arr.map(
        Arr.filter(HashMap.values(known), (local) => declaresTypeAlias(local.declarations) && !HashMap.has(done, local.key)),
        (local) => local.key,
      )
      return yield* Arr.match(pending, {
        onEmpty: () => Effect.void,
        onNonEmpty: (keys) => Effect.flatMap(Effect.forEach(keys, (key) => buildOneLocal(contextFor, reachable, built, key)), () => drain()),
      })
    })
  return drain()
}

const buildEntry = (graph: DeclarationGraph, entry: EntryFile): Effect.Effect<EntryPoint, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const file = entry.declarationFile
    const exported = exportedNames(graph, file)
    const index = reverseIndex(graph, file, exported)
    const reachable = yield* Ref.make(HashMap.empty<string, LocalDeclaration>())
    const built = yield* Ref.make(HashMap.empty<string, TypeAliasItem>())
    const naming: Naming = { localNameOf: (at, name, declarations) => localNameOf(reachable, index, at, name, declarations) }
    const contextFor = (at: string): TypeContext => ({ graph, file: at, naming, typeParameters: HashSet.empty() })
    const items = yield* Effect.forEach(exported, (name) => itemsForExport(graph, contextFor, file, name, HashSet.empty()))
    yield* buildReachableLocals(contextFor, reachable, built)
    const rename = assignNames(exported, yield* Ref.get(reachable))
    const locals = Arr.fromIterable(HashMap.values(yield* Ref.get(built))).map((alias) => renameAlias(alias, rename))
    return { path: entry.exportPath, items: items.flat().map((item) => renameItem(item, rename)), locals }
  })

export type ModelOfGraphRequest = {
  readonly graph: DeclarationGraph
  readonly producer: Declarations['producer']
  readonly package: Declarations['package']
}

export const modelOfGraph = (request: ModelOfGraphRequest): Effect.Effect<ApiModel, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(request.graph.entryPoints, (entry) => buildEntry(request.graph, entry)), (entryPoints) =>
    sortModel({
      schemaVersion: API_MODEL_SCHEMA_VERSION,
      producer: { engine: ENGINE, declarations: request.producer },
      package: request.package,
      entryPoints,
    }),
  )

export const buildModel = (declarations: Declarations): Effect.Effect<ApiModel, UnsupportedDeclaration> =>
  Effect.flatMap(declarationGraph(declarations), (graph) =>
    modelOfGraph({ graph, producer: declarations.producer, package: declarations.package }),
  )
