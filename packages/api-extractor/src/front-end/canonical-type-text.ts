import { Array as Arr, Effect, HashMap, HashSet, Match, Option } from 'effect'
import type {
  BindingPattern,
  Expression,
  ParamPattern,
  PropertyKey,
  TSCallSignatureDeclaration,
  TSConditionalType,
  TSConstructSignatureDeclaration,
  TSConstructorType,
  TSFunctionType,
  TSImportType,
  TSImportTypeQualifier,
  TSIndexSignature,
  TSIndexedAccessType,
  TSInferType,
  TSLiteral,
  TSMappedType,
  TSMethodSignature,
  TSMethodSignatureKind,
  TSNamedTupleMember,
  TSOptionalType,
  TSPropertySignature,
  TSRestType,
  TSSignature,
  TSTemplateLiteralType,
  TSTupleElement,
  TSTupleType,
  TSType,
  TSTypeAnnotation,
  TSTypeName,
  TSTypeOperator,
  TSTypeParameter,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypePredicate,
  TSTypeQuery,
  TSTypeReference,
  TemplateElement,
} from 'oxc-parser'
import type { KeywordName } from '../model/type-expr.schema.ts'
import { type Declaration, type DeclarationGraph, isRelativeSpecifier, resolveFile, resolveName } from './declaration-graph.ts'
import { UnsupportedDeclaration } from './front-end-error.schema.ts'

export type ReferenceTarget = {
  readonly name: string
  readonly module: Option.Option<string>
}

export type Naming = {
  readonly localNameOf: (file: string, localName: string, declarations: ReadonlyArray<Declaration>) => Effect.Effect<string>
}

export type TypeContext = {
  readonly graph: DeclarationGraph
  readonly file: string
  readonly naming: Naming
  readonly typeParameters: HashSet.HashSet<string>
}

const withTypeParameters = (context: TypeContext, names: ReadonlyArray<string>): TypeContext => ({
  ...context,
  typeParameters: HashSet.union(context.typeParameters, HashSet.fromIterable(names)),
})

const refuse = (file: string, construct: string): Effect.Effect<never, UnsupportedDeclaration> =>
  Effect.fail(new UnsupportedDeclaration({ file, construct }))

export const KEYWORD_ENTRIES = [
  ['TSAnyKeyword', 'any'],
  ['TSBigIntKeyword', 'bigint'],
  ['TSBooleanKeyword', 'boolean'],
  ['TSNeverKeyword', 'never'],
  ['TSNullKeyword', 'null'],
  ['TSNumberKeyword', 'number'],
  ['TSObjectKeyword', 'object'],
  ['TSStringKeyword', 'string'],
  ['TSSymbolKeyword', 'symbol'],
  ['TSUndefinedKeyword', 'undefined'],
  ['TSUnknownKeyword', 'unknown'],
  ['TSVoidKeyword', 'void'],
] as const

type KeywordNodeName = (typeof KEYWORD_ENTRIES)[number][0]

const KEYWORDS: HashMap.HashMap<string, KeywordName> = HashMap.fromIterable<string, KeywordName>(KEYWORD_ENTRIES)

export const KEYWORD_NODE_NAMES: ReadonlyArray<KeywordNodeName> = KEYWORD_ENTRIES.map(([node]) => node)

export const keywordNameOf = (nodeType: string): Option.Option<KeywordName> => HashMap.get(KEYWORDS, nodeType)

const keywordName = (nodeType: string): KeywordName => Option.getOrThrow(keywordNameOf(nodeType))

export const literalTextOf = (node: Expression | TSLiteral): Option.Option<string> =>
  Match.value(node).pipe(
    Match.when({ type: 'Literal', value: Match.string }, (literal) => Option.some(JSON.stringify(literal.value))),
    Match.when({ type: 'Literal', value: Match.number }, (literal) => Option.some(String(literal.value))),
    Match.when({ type: 'Literal', value: Match.bigint }, (literal) => Option.some(`${literal.value}n`)),
    Match.when({ type: 'Literal', value: Match.boolean }, (literal) => Option.some(literal.raw ?? String(literal.value))),
    Match.when({ type: 'TemplateLiteral', expressions: [] }, (literal) => Option.map(Arr.head(literal.quasis), (quasi) => `\`${quasi.value.raw}\``)),
    Match.when({ type: 'UnaryExpression', operator: '-' }, (unary) => Option.map(literalTextOf(unary.argument), (text) => `-${text}`)),
    Match.orElse(() => Option.none()),
  )

export const expressionPath = (expression: Expression): Option.Option<ReadonlyArray<string>> =>
  Match.value(expression).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.some<ReadonlyArray<string>>([identifier.name])),
    Match.when({ type: 'ThisExpression' }, () => Option.some<ReadonlyArray<string>>(['this'])),
    Match.when({ type: 'MemberExpression', computed: false, property: { type: 'Identifier' } }, (member) =>
      Option.map(expressionPath(member.object), (base) => [...base, member.property.name])),
    Match.orElse(() => Option.none()),
  )

export const propertyKeyName = (key: PropertyKey): Option.Option<string> =>
  Match.value(key).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.some(identifier.name)),
    Match.when({ type: 'Literal', value: Match.string }, (literal) => Option.some(JSON.stringify(literal.value))),
    Match.when({ type: 'Literal', value: Match.number }, (literal) => Option.some(String(literal.value))),
    Match.when({ type: 'PrivateIdentifier' }, (identifier) => Option.some(`#${identifier.name}`)),
    Match.when({ type: 'MemberExpression', computed: false, property: { type: 'Identifier' } }, (member) =>
      Option.map(expressionPath(member.object), (base) => `[${[...base, member.property.name].join('.')}]`)),
    Match.orElse(() => Option.none()),
  )

export const nameSegments = (name: TSTypeName): ReadonlyArray<string> =>
  Match.value(name).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => [identifier.name]),
    Match.when({ type: 'TSQualifiedName' }, (qualified) => [...nameSegments(qualified.left), qualified.right.name]),
    Match.when({ type: 'ThisExpression' }, () => ['this']),
    Match.orElse(() => []),
  )

export const importSegments = (qualifier: TSImportTypeQualifier | null): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(qualifier), {
    onNone: () => [],
    onSome: (name) =>
      Match.value(name).pipe(
        Match.when({ type: 'Identifier' }, (identifier) => [identifier.name]),
        Match.when({ type: 'TSQualifiedName' }, (qualified) => [...importSegments(qualified.left), qualified.right.name]),
        Match.orElse(() => []),
      ),
  })

export const typeParameterNames = (declaration: TSTypeParameterDeclaration | null | undefined): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(declaration), {
    onNone: () => [],
    onSome: (parameters) => parameters.params.map((parameter) => parameter.name.name),
  })

const plainTarget = (segments: ReadonlyArray<string>): ReferenceTarget => ({ name: segments.join('.'), module: Option.none() })

const qualify = (name: string, rest: ReadonlyArray<string>): string =>
  Arr.match(rest, { onEmpty: () => name, onNonEmpty: (parts) => `${name}.${parts.join('.')}` })

const targetOf = (context: TypeContext, file: string, segments: ReadonlyArray<string>): Effect.Effect<ReferenceTarget> =>
  Arr.match(segments, {
    onEmpty: () => Effect.succeed(plainTarget(segments)),
    onNonEmpty: ([head, ...rest]) =>
      HashSet.has(context.typeParameters, head)
        ? Effect.succeed(plainTarget(segments))
        : Option.match(resolveName(context.graph, file, head), {
            onNone: () => Effect.succeed(plainTarget(segments)),
            onSome: (symbol) =>
              Match.value(symbol).pipe(
                Match.when({ kind: 'external' }, (external) => Effect.succeed({ name: segments.join('.'), module: Option.some(external.module) })),
                Match.when({ kind: 'local' }, (local) =>
                  Effect.map(context.naming.localNameOf(local.file, local.name, local.declarations), (name) => ({
                    name: qualify(name, rest),
                    module: Option.none(),
                  }))),
                Match.when({ kind: 'namespace' }, (namespace) => targetOf(context, namespace.file, rest)),
                Match.exhaustive,
              ),
          }),
  })

const referenceTargetFor = (
  context: TypeContext,
  segments: ReadonlyArray<string>,
  source: Option.Option<string>,
): Effect.Effect<ReferenceTarget> =>
  Option.match(source, {
    onNone: () => targetOf(context, context.file, segments),
    onSome: (specifier) =>
      isRelativeSpecifier(specifier)
        ? Option.match(resolveFile(context.graph, context.file, specifier), {
            onNone: () => Effect.succeed(plainTarget(segments)),
            onSome: (file) => targetOf(context, file, segments),
          })
        : Effect.succeed({ name: segments.join('.'), module: Option.some(specifier) }),
  })

const printReference = (target: ReferenceTarget, args: string): string =>
  Option.match(target.module, {
    onNone: () => `${target.name}${args}`,
    onSome: (module) => `import(${JSON.stringify(module)}).${target.name}${args}`,
  })

const readonlyPrefix = (readonly: boolean): string => (readonly ? 'readonly ' : '')
const optionalMark = (optional: boolean): string => (optional ? '?' : '')

const printOptional = (
  context: TypeContext,
  node: TSType | null | undefined,
  decorate: (text: string) => string,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => Effect.succeed(''),
    onSome: (type) => Effect.map(canonicalTypeText(context, type), decorate),
  })

const annotationTypeOf = (annotation: TSTypeAnnotation | null | undefined): TSType | undefined => annotation?.typeAnnotation

const printAnnotationOrDefault = (
  context: TypeContext,
  annotation: TSTypeAnnotation | null | undefined,
  fallback: KeywordName,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(annotation), {
    onNone: () => Effect.succeed(fallback),
    onSome: (present) => canonicalTypeText(context, present.typeAnnotation),
  })

const printTypeParameter = (context: TypeContext, parameter: TSTypeParameter): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const constraint = yield* printOptional(context, parameter.constraint, (text) => ` extends ${text}`)
    const fallback = yield* printOptional(context, parameter.default, (text) => ` = ${text}`)
    return `${parameter.name.name}${constraint}${fallback}`
  })

const printTypeParameters = (context: TypeContext, declaration: TSTypeParameterDeclaration | null): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(declaration), {
    onNone: () => Effect.succeed(''),
    onSome: (parameters) =>
      Effect.map(Effect.forEach(parameters.params, (parameter) => printTypeParameter(context, parameter)), (parts) => `<${parts.join(', ')}>`),
  })

const printTypeArguments = (context: TypeContext, instantiation: TSTypeParameterInstantiation | null): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(instantiation), {
    onNone: () => Effect.succeed(''),
    onSome: (arguments_) =>
      Arr.match(arguments_.params, {
        onEmpty: () => Effect.succeed(''),
        onNonEmpty: (params) =>
          Effect.map(Effect.forEach(params, (param) => canonicalTypeText(context, param)), (parts) => `<${parts.join(', ')}>`),
      }),
  })

const bindingName = (pattern: BindingPattern): string =>
  Match.value(pattern).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => identifier.name),
    Match.when({ type: 'AssignmentPattern', left: { type: 'Identifier' } }, (assignment) => assignment.left.name),
    Match.orElse(() => '_'),
  )

const printParameter = (context: TypeContext, parameter: ParamPattern): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(parameter).pipe(
    Match.when({ type: 'TSParameterProperty' }, (property) => printParameter(context, property.parameter)),
    Match.when({ type: 'RestElement' }, (rest) =>
      Effect.map(printAnnotationOrDefault(context, rest.typeAnnotation, 'any'), (type) => `...${bindingName(rest.argument)}: ${type}`)),
    Match.when({ type: 'Identifier' }, (identifier) =>
      Effect.map(printAnnotationOrDefault(context, identifier.typeAnnotation, 'any'), (type) =>
        `${bindingName(identifier)}${optionalMark(identifier.optional ?? false)}: ${type}`)),
    Match.orElse(() => refuse(context.file, 'a destructuring parameter')),
  )

const printParameters = (context: TypeContext, parameters: ReadonlyArray<ParamPattern>): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(parameters, (parameter) => printParameter(context, parameter)), (parts) => parts.join(', '))

const printMethodTail = (
  context: TypeContext,
  kind: TSMethodSignatureKind,
  returnType: TSTypeAnnotation | null,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(kind).pipe(
    Match.when('set', () => Effect.succeed('')),
    Match.orElse(() => Effect.map(printAnnotationOrDefault(context, returnType, 'any'), (type) => `: ${type}`)),
  )

const printArrowTail = (
  context: TypeContext,
  returnType: TSTypeAnnotation | null,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.map(printAnnotationOrDefault(context, returnType, 'any'), (type) => ` => ${type}`)

type ReturnTail = (context: TypeContext, returnType: TSTypeAnnotation | null) => Effect.Effect<string, UnsupportedDeclaration>

const methodTail = (kind: TSMethodSignatureKind): ReturnTail => (context, returnType) => printMethodTail(context, kind, returnType)

const printSignatureLike = (
  context: TypeContext,
  typeParameters: TSTypeParameterDeclaration | null,
  params: ReadonlyArray<ParamPattern>,
  returnType: TSTypeAnnotation | null,
  tail: ReturnTail,
  decorate: (parts: { readonly typeParameters: string; readonly parameters: string; readonly returnType: string }) => string,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const inner = withTypeParameters(context, typeParameterNames(typeParameters))
    const printedTypeParameters = yield* printTypeParameters(inner, typeParameters)
    const printedParameters = yield* printParameters(inner, params)
    const printedReturnType = yield* tail(inner, returnType)
    return decorate({ typeParameters: printedTypeParameters, parameters: printedParameters, returnType: printedReturnType })
  })

const printPropertySignature = (context: TypeContext, member: TSPropertySignature): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(propertyKeyName(member.key), {
    onNone: () => refuse(context.file, `a ${member.key.type} member name`),
    onSome: (name) =>
      Effect.map(printAnnotationOrDefault(context, member.typeAnnotation, 'any'), (type) =>
        `${readonlyPrefix(member.readonly)}${name}${optionalMark(member.optional)}: ${type}`),
  })

const printMethodSignature = (context: TypeContext, member: TSMethodSignature): Effect.Effect<string, UnsupportedDeclaration> =>
  Option.match(propertyKeyName(member.key), {
    onNone: () => refuse(context.file, `a ${member.key.type} method name`),
    onSome: (name) =>
      printSignatureLike(context, member.typeParameters, member.params, member.returnType, methodTail(member.kind), (parts) =>
        `${methodPrefix(member.kind)}${name}${optionalMark(member.optional)}${parts.typeParameters}(${parts.parameters})${parts.returnType}`),
  })

const methodPrefix = (kind: TSMethodSignatureKind): string =>
  Match.value(kind).pipe(
    Match.when('get', () => 'get '),
    Match.when('set', () => 'set '),
    Match.orElse(() => ''),
  )

const printCallSignature = (context: TypeContext, member: TSCallSignatureDeclaration): Effect.Effect<string, UnsupportedDeclaration> =>
  printSignatureLike(context, member.typeParameters, member.params, member.returnType, methodTail('method'), (parts) =>
    `${parts.typeParameters}(${parts.parameters})${parts.returnType}`)

const printConstructSignature = (context: TypeContext, member: TSConstructSignatureDeclaration): Effect.Effect<string, UnsupportedDeclaration> =>
  printSignatureLike(context, member.typeParameters, member.params, member.returnType, methodTail('method'), (parts) =>
    `new ${parts.typeParameters}(${parts.parameters})${parts.returnType}`)

const printIndexSignature = (context: TypeContext, member: TSIndexSignature): Effect.Effect<string, UnsupportedDeclaration> =>
  Arr.match(member.parameters, {
    onEmpty: () => refuse(context.file, 'an index signature without a parameter'),
    onNonEmpty: ([parameter]) =>
      Effect.gen(function* () {
        const key = yield* canonicalTypeText(context, parameter.typeAnnotation.typeAnnotation)
        const value = yield* canonicalTypeText(context, member.typeAnnotation.typeAnnotation)
        return `${readonlyPrefix(member.readonly)}[${parameter.name}: ${key}]: ${value}`
      }),
  })

const printMember = (context: TypeContext, member: TSSignature): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(member).pipe(
    Match.when({ type: 'TSPropertySignature' }, (property) => printPropertySignature(context, property)),
    Match.when({ type: 'TSMethodSignature' }, (method) => printMethodSignature(context, method)),
    Match.when({ type: 'TSCallSignatureDeclaration' }, (call) => printCallSignature(context, call)),
    Match.when({ type: 'TSIndexSignature' }, (index) => printIndexSignature(context, index)),
    Match.when({ type: 'TSConstructSignatureDeclaration' }, (construct) => printConstructSignature(context, construct)),
    Match.orElse(() => refuse(context.file, 'an unsupported member')),
  )

const printMembers = (context: TypeContext, members: ReadonlyArray<TSSignature>): Effect.Effect<string, UnsupportedDeclaration> =>
  Arr.match(members, {
    onEmpty: () => Effect.succeed('{}'),
    onNonEmpty: (present) =>
      Effect.map(Effect.forEach(present, (member) => printMember(context, member)), (parts) => `{ ${parts.join('; ')} }`),
  })

const printSpecialTupleElement = (
  context: TypeContext,
  element: TSNamedTupleMember | TSOptionalType | TSRestType,
): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(element).pipe(
    Match.when({ type: 'TSNamedTupleMember' }, (named) =>
      Effect.map(printTupleElement(context, named.elementType), (type) => `${named.label.name}${optionalMark(named.optional)}: ${type}`)),
    Match.when({ type: 'TSOptionalType' }, (optional) =>
      Effect.map(canonicalTypeText(context, optional.typeAnnotation), (type) => `${type}?`)),
    Match.orElse((rest) => Effect.map(canonicalTypeText(context, rest.typeAnnotation), (type) => `...${type}`)),
  )

const printTupleElement = (context: TypeContext, element: TSTupleElement): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(element).pipe(
    Match.when({ type: Match.is('TSNamedTupleMember', 'TSOptionalType', 'TSRestType') }, (special) => printSpecialTupleElement(context, special)),
    Match.orElse((plain) => canonicalTypeText(context, plain)),
  )

const printTuple = (context: TypeContext, node: TSTupleType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(node.elementTypes, (element) => printTupleElement(context, element)), (parts) => `[${parts.join(', ')}]`)

const printFunctionType = (context: TypeContext, node: TSFunctionType): Effect.Effect<string, UnsupportedDeclaration> =>
  printSignatureLike(context, node.typeParameters, node.params, node.returnType, printArrowTail, (parts) =>
    `${parts.typeParameters}(${parts.parameters})${parts.returnType}`)

const printConstructorType = (context: TypeContext, node: TSConstructorType): Effect.Effect<string, UnsupportedDeclaration> =>
  printSignatureLike(context, node.typeParameters, node.params, node.returnType, printArrowTail, (parts) =>
    `${node.abstract ? 'abstract ' : ''}new ${parts.typeParameters}(${parts.parameters})${parts.returnType}`)

const printTypeReference = (context: TypeContext, node: TSTypeReference): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const target = yield* referenceTargetFor(context, nameSegments(node.typeName), Option.none())
    const args = yield* printTypeArguments(context, node.typeArguments)
    return printReference(target, args)
  })

const printImportType = (context: TypeContext, node: TSImportType): Effect.Effect<string, UnsupportedDeclaration> =>
  Arr.match(importSegments(node.qualifier), {
    onEmpty: () => refuse(context.file, 'a bare import type'),
    onNonEmpty: (segments) =>
      Effect.gen(function* () {
        const target = yield* referenceTargetFor(context, segments, Option.some(node.source.value))
        const args = yield* printTypeArguments(context, node.typeArguments)
        return printReference(target, args)
      }),
  })

const printQuery = (context: TypeContext, node: TSTypeQuery): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(node.exprName).pipe(
    Match.when({ type: 'TSImportType' }, (imported) => Effect.map(printImportType(context, imported), (text) => `typeof ${text}`)),
    Match.orElse((name) =>
      Effect.map(referenceTargetFor(context, nameSegments(name), Option.none()), (target) => `typeof ${printReference(target, '')}`)),
  )

const mappedReadonlyPrefix = (readonly: TSMappedType['readonly']): string =>
  Match.value(readonly).pipe(
    Match.when(true, () => 'readonly '),
    Match.when('+', () => '+readonly '),
    Match.when('-', () => '-readonly '),
    Match.orElse(() => ''),
  )

const mappedOptionalSuffix = (optional: TSMappedType['optional']): string =>
  Match.value(optional).pipe(
    Match.when(true, () => '?'),
    Match.when('+', () => '+?'),
    Match.when('-', () => '-?'),
    Match.orElse(() => ''),
  )

const printMappedType = (context: TypeContext, node: TSMappedType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const inner = withTypeParameters(context, [node.key.name])
    const constraint = yield* canonicalTypeText(inner, node.constraint)
    const nameType = yield* printOptional(inner, node.nameType, (text) => ` as ${text}`)
    const value = yield* printOptional(inner, node.typeAnnotation, (text) => `: ${text}`)
    return `{ ${mappedReadonlyPrefix(node.readonly)}[${node.key.name} in ${constraint}${nameType}]${mappedOptionalSuffix(node.optional)}${value} }`
  })

const printConditional = (context: TypeContext, node: TSConditionalType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const check = yield* canonicalTypeText(context, node.checkType)
    const extending = yield* canonicalTypeText(context, node.extendsType)
    const consequent = yield* canonicalTypeText(context, node.trueType)
    const alternate = yield* canonicalTypeText(context, node.falseType)
    return `${check} extends ${extending} ? ${consequent} : ${alternate}`
  })

const printInfer = (context: TypeContext, node: TSInferType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const constraint = yield* printOptional(context, node.typeParameter.constraint, (text) => ` extends ${text}`)
    return `infer ${node.typeParameter.name.name}${constraint}`
  })

const printPredicate = (context: TypeContext, node: TSTypePredicate): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const tail = yield* printOptional(context, annotationTypeOf(node.typeAnnotation), (text) => ` is ${text}`)
    const name = Match.value(node.parameterName).pipe(
      Match.when({ type: 'Identifier' }, (identifier) => identifier.name),
      Match.orElse(() => 'this'),
    )
    return `${node.asserts ? 'asserts ' : ''}${name}${tail}`
  })

const templateRaw = (quasis: ReadonlyArray<TemplateElement>, index: number): string =>
  Option.match(Arr.get(quasis, index), { onNone: () => '', onSome: (quasi) => quasi.value.raw })

const printTemplate = (context: TypeContext, node: TSTemplateLiteralType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const parts = yield* Effect.forEach(
      Arr.map(node.types, (type, index) => ({ quasi: templateRaw(node.quasis, index), type })),
      (part) => Effect.map(canonicalTypeText(context, part.type), (text) => `${part.quasi}\${${text}}`),
    )
    return `\`${parts.join('')}${templateRaw(node.quasis, node.types.length)}\``
  })

const printOperator = (context: TypeContext, node: TSTypeOperator): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.map(canonicalTypeText(context, node.typeAnnotation), (text) => `${node.operator} ${text}`)

const printIndexedAccess = (context: TypeContext, node: TSIndexedAccessType): Effect.Effect<string, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const object = yield* canonicalTypeText(context, node.objectType)
    const index = yield* canonicalTypeText(context, node.indexType)
    return `${object}[${index}]`
  })

const canonicalTypeText = (context: TypeContext, node: TSType): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(node).pipe(
    Match.when({ type: Match.is(...KEYWORD_NODE_NAMES) }, (keyword) => Effect.succeed(keywordName(keyword.type))),
    Match.when({ type: 'TSThisType' }, () => Effect.succeed('this')),
    Match.when({ type: 'TSIntrinsicKeyword' }, () => Effect.succeed('intrinsic')),
    Match.when({ type: 'TSLiteralType' }, (literal) =>
      Option.match(literalTextOf(literal.literal), {
        onNone: () => refuse(context.file, 'TSLiteralType'),
        onSome: (text) => Effect.succeed(text),
      })),
    Match.when({ type: 'TSTypeReference' }, (reference) => printTypeReference(context, reference)),
    Match.when({ type: 'TSImportType' }, (imported) => printImportType(context, imported)),
    Match.when({ type: 'TSUnionType' }, (union) =>
      Effect.map(Effect.forEach(union.types, (member) => canonicalTypeText(context, member)), (parts) => parts.join(' | '))),
    Match.when({ type: 'TSIntersectionType' }, (intersection) =>
      Effect.map(Effect.forEach(intersection.types, (member) => canonicalTypeText(context, member)), (parts) => parts.join(' & '))),
    Match.when({ type: 'TSParenthesizedType' }, (parenthesised) =>
      Effect.map(canonicalTypeText(context, parenthesised.typeAnnotation), (text) => `(${text})`)),
    Match.when({ type: 'TSTypeOperator' }, (operator) => printOperator(context, operator)),
    Match.when({ type: 'TSArrayType' }, (array) => Effect.map(canonicalTypeText(context, array.elementType), (text) => `${text}[]`)),
    Match.when({ type: 'TSIndexedAccessType' }, (indexed) => printIndexedAccess(context, indexed)),
    Match.when({ type: 'TSTupleType' }, (tuple) => printTuple(context, tuple)),
    Match.when({ type: 'TSFunctionType' }, (function_) => printFunctionType(context, function_)),
    Match.when({ type: 'TSConstructorType' }, (constructor) => printConstructorType(context, constructor)),
    Match.orElse((other) => printStructuredType(context, other)),
  )

const printStructuredType = (context: TypeContext, node: TSType): Effect.Effect<string, UnsupportedDeclaration> =>
  Match.value(node).pipe(
    Match.when({ type: 'TSTypeLiteral' }, (literal) => printMembers(context, literal.members)),
    Match.when({ type: 'TSMappedType' }, (mapped) => printMappedType(context, mapped)),
    Match.when({ type: 'TSConditionalType' }, (conditional) => printConditional(context, conditional)),
    Match.when({ type: 'TSInferType' }, (infer) => printInfer(context, infer)),
    Match.when({ type: 'TSTemplateLiteralType' }, (template) => printTemplate(context, template)),
    Match.when({ type: 'TSTypePredicate' }, (predicate) => printPredicate(context, predicate)),
    Match.when({ type: 'TSTypeQuery' }, (query) => printQuery(context, query)),
    Match.orElse(() => refuse(context.file, `a ${node.type} type`)),
  )

export const TypePrinting: {
  readonly canonicalTypeText: (context: TypeContext, node: TSType) => Effect.Effect<string, UnsupportedDeclaration>
  readonly referenceTargetFor: (
    context: TypeContext,
    segments: ReadonlyArray<string>,
    source: Option.Option<string>,
  ) => Effect.Effect<ReferenceTarget>
  readonly withTypeParameters: (context: TypeContext, names: ReadonlyArray<string>) => TypeContext
  readonly refuse: (file: string, construct: string) => Effect.Effect<never, UnsupportedDeclaration>
  readonly bindingName: (pattern: BindingPattern) => string
} = {
  canonicalTypeText: canonicalTypeText,
  referenceTargetFor: referenceTargetFor,
  withTypeParameters: withTypeParameters,
  refuse: refuse,
  bindingName: bindingName,
}
