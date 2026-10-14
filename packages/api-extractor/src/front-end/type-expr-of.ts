import { Array as Arr, Effect, HashMap, Match, Option } from 'effect'
import type {
  AccessorProperty,
  ClassElement,
  Expression,
  MethodDefinition,
  ParamPattern,
  PropertyDefinition,
  PropertyKey,
  TSAccessibility,
  TSCallSignatureDeclaration,
  TSClassImplements,
  TSConstructSignatureDeclaration,
  TSIndexSignature,
  TSInterfaceHeritage,
  TSLiteralType,
  TSMethodSignature,
  TSPropertySignature,
  TSSignature,
  TSTupleElement,
  TSType,
  TSTypeAnnotation,
  TSTypeLiteral,
  TSTypeOperator,
  TSTypeParameter,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
} from 'oxc-parser'
import { normaliseType, type KeywordName, type Member, type Parameter, type Signature, type TypeExpr, type TypeParameter } from '../model/type-expr.schema.ts'
import {
  expressionPath,
  importSegments,
  KEYWORD_NODE_NAMES,
  keywordNameOf,
  literalTextOf,
  nameSegments,
  propertyKeyName,
  typeParameterNames,
  TypePrinting,
  type TypeContext,
} from './canonical-type-text.ts'
import { refuse } from './declaration-graph.ts'
import { UnsupportedDeclaration } from './front-end-error.schema.ts'

const { bindingName, canonicalTypeText, inValueSpace, referenceTargetFor, withNamesInScope } = TypePrinting

const unknownKeyword: TypeExpr = { kind: 'keyword', name: 'unknown' }

const moduleField = (module: Option.Option<string>): { readonly module?: string } =>
  Option.match(module, { onNone: () => ({}), onSome: (value) => ({ module: value }) })

const referenceExpr = (name: string, module: Option.Option<string>, args: ReadonlyArray<TypeExpr>): TypeExpr => ({
  kind: 'reference',
  name,
  ...moduleField(module),
  args,
})

const textExpr = (context: TypeContext, node: TSType): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Effect.map(canonicalTypeText(context, node), (text): TypeExpr => ({ kind: 'text', text }))

const propertyKeyNameOf = (key: PropertyKey): Option.Option<string> =>
  Match.value(key).pipe(
    Match.when({ type: 'PrivateIdentifier' }, () => Option.none()),
    Match.orElse(() => propertyKeyName(key)),
  )

const typeArgumentsOf = (
  context: TypeContext,
  instantiation: TSTypeParameterInstantiation | null | undefined,
): Effect.Effect<ReadonlyArray<TypeExpr>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(instantiation), {
    onNone: () => Effect.succeed<ReadonlyArray<TypeExpr>>([]),
    onSome: (present) => Effect.forEach(present.params, (param) => typeExprOf(context, param)),
  })

type ReferenceRequest = {
  readonly targetContext: TypeContext
  readonly segments: ReadonlyArray<string>
  readonly source: Option.Option<string>
}

const referenceTypeOf = (
  context: TypeContext,
  request: ReferenceRequest,
  typeArguments: TSTypeParameterInstantiation | null | undefined,
): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const target = yield* referenceTargetFor(request.targetContext, request.segments, request.source)
    const args = yield* typeArgumentsOf(context, typeArguments)
    return referenceExpr(target.name, target.module, args)
  })

const annotationTypeOrDefault = (
  context: TypeContext,
  annotation: TSTypeAnnotation | null | undefined,
  fallback: KeywordName,
): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(annotation), {
    onNone: () => Effect.succeed<TypeExpr>({ kind: 'keyword', name: fallback }),
    onSome: (present) => typeExprOf(context, present.typeAnnotation),
  })

const constraintOf = (context: TypeContext, node: TSType | null): Effect.Effect<Pick<TypeParameter, 'constraint'>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => Effect.succeed({}),
    onSome: (type) => Effect.map(typeExprOf(context, type), (constraint) => ({ constraint })),
  })

const defaultOf = (context: TypeContext, node: TSType | null): Effect.Effect<Pick<TypeParameter, 'default'>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => Effect.succeed({}),
    onSome: (type) => Effect.map(typeExprOf(context, type), (fallback) => ({ default: fallback })),
  })

const typeParameterOf = (context: TypeContext, parameter: TSTypeParameter): Effect.Effect<TypeParameter, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const constraint = yield* constraintOf(context, parameter.constraint)
    const fallback = yield* defaultOf(context, parameter.default)
    return { name: parameter.name.name, ...constraint, ...fallback }
  })

const typeParametersOf = (
  context: TypeContext,
  declaration: TSTypeParameterDeclaration | null | undefined,
): Effect.Effect<ReadonlyArray<TypeParameter>, UnsupportedDeclaration> =>
  Option.match(Option.fromNullishOr(declaration), {
    onNone: () => Effect.succeed<ReadonlyArray<TypeParameter>>([]),
    onSome: (present) => {
      const inner = withNamesInScope(context, typeParameterNames(present))
      return Effect.forEach(present.params, (parameter) => typeParameterOf(inner, parameter))
    },
  })

const parameterOf = (context: TypeContext, parameter: ParamPattern): Effect.Effect<Parameter, UnsupportedDeclaration> =>
  Match.value(parameter).pipe(
    Match.when({ type: 'TSParameterProperty' }, (property) => parameterOf(context, property.parameter)),
    Match.when({ type: 'RestElement' }, (rest) =>
      Effect.map(annotationTypeOrDefault(context, rest.typeAnnotation, 'any'), (type): Parameter => ({
        name: bindingName(rest.argument),
        type,
        optional: rest.optional ?? false,
        rest: true,
      }))),
    Match.when({ type: 'Identifier' }, (identifier) =>
      Effect.map(annotationTypeOrDefault(context, identifier.typeAnnotation, 'any'), (type): Parameter => ({
        name: bindingName(identifier),
        type,
        optional: identifier.optional ?? false,
        rest: false,
      }))),
    Match.orElse(() => refuse(context.file, 'a destructuring parameter')),
  )

const parametersOf = (context: TypeContext, params: ReadonlyArray<ParamPattern>): Effect.Effect<ReadonlyArray<Parameter>, UnsupportedDeclaration> =>
  Effect.forEach(params, (parameter) => parameterOf(context, parameter))

const signatureOf = (
  context: TypeContext,
  typeParameters: TSTypeParameterDeclaration | null | undefined,
  params: ReadonlyArray<ParamPattern>,
  returnType: TSTypeAnnotation | null | undefined,
): Effect.Effect<Signature, UnsupportedDeclaration> =>
  Effect.gen(function* () {
    const inner = withNamesInScope(context, typeParameterNames(typeParameters))
    const bound = yield* typeParametersOf(inner, typeParameters)
    const parameters = yield* parametersOf(inner, params)
    const returns = yield* annotationTypeOrDefault(inner, returnType, 'any')
    return { typeParameters: bound, parameters, returns }
  })

const referenceToExpression = (
  context: TypeContext,
  targetContext: TypeContext,
  expression: Expression,
  typeArguments: TSTypeParameterInstantiation | null | undefined,
): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Option.match(expressionPath(expression), {
    onNone: () => refuse(context.file, `a ${expression.type} heritage clause`),
    onSome: (segments) => referenceTypeOf(context, { targetContext, segments, source: Option.none() }, typeArguments),
  })

const heritageOf = (context: TypeContext, heritage: TSInterfaceHeritage | TSClassImplements): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  referenceToExpression(context, context, heritage.expression, heritage.typeArguments)

const superClassOf = (
  context: TypeContext,
  expression: Expression,
  typeArguments: TSTypeParameterInstantiation | null | undefined,
): Effect.Effect<TypeExpr, UnsupportedDeclaration> => referenceToExpression(context, inValueSpace(context), expression, typeArguments)

type DraftMethod = {
  readonly kind: 'method'
  readonly name: string
  readonly optional: boolean
  readonly signatures: ReadonlyArray<Signature>
}

type DraftAccessor = {
  readonly kind: 'accessor'
  readonly name: string
  readonly get: Option.Option<Signature>
  readonly set: Option.Option<Signature>
}

type Draft = { readonly kind: 'member'; readonly member: Member } | DraftMethod | DraftAccessor

const draftKey = (draft: Draft): Option.Option<string> =>
  Match.value(draft).pipe(
    Match.when({ kind: 'method' }, (method) => Option.some(`method\u0000${method.name}`)),
    Match.when({ kind: 'accessor' }, (accessor) => Option.some(`accessor\u0000${accessor.name}`)),
    Match.orElse(() => Option.none()),
  )

const appendDraft = (existing: Draft, incoming: Draft): Draft =>
  Match.value(existing).pipe(
    Match.when({ kind: 'method' }, (method) =>
      Match.value(incoming).pipe(
        Match.when({ kind: 'method' }, (other) => ({ ...method, signatures: [...method.signatures, ...other.signatures] })),
        Match.orElse(() => existing),
      )),
    Match.when({ kind: 'accessor' }, (accessor) =>
      Match.value(incoming).pipe(
        Match.when({ kind: 'accessor' }, (other) => ({
          ...accessor,
          get: Option.orElse(accessor.get, () => other.get),
          set: Option.orElse(accessor.set, () => other.set),
        })),
        Match.orElse(() => existing),
      )),
    Match.orElse(() => existing),
  )

type DraftState = { readonly ordered: ReadonlyArray<Draft>; readonly index: HashMap.HashMap<string, number> }

const mergeDraft = (state: DraftState, draft: Draft): DraftState =>
  Option.match(draftKey(draft), {
    onNone: () => ({ ordered: [...state.ordered, draft], index: state.index }),
    onSome: (key) =>
      Option.match(HashMap.get(state.index, key), {
        onNone: () => ({ ordered: [...state.ordered, draft], index: HashMap.set(state.index, key, state.ordered.length) }),
        onSome: (position) => ({
          ordered: Arr.map(state.ordered, (existing, at) => (at === position ? appendDraft(existing, draft) : existing)),
          index: state.index,
        }),
      }),
  })

const accessorType = (draft: DraftAccessor): TypeExpr =>
  Option.match(draft.get, {
    onSome: (signature) => signature.returns,
    onNone: () =>
      Option.match(draft.set, {
        onSome: (signature) => Option.getOrElse(Option.map(Arr.head(signature.parameters), (parameter) => parameter.type), () => unknownKeyword),
        onNone: () => unknownKeyword,
      }),
  })

const finalise = (draft: Draft): Member =>
  Match.value(draft).pipe(
    Match.when({ kind: 'member' }, (member) => member.member),
    Match.when({ kind: 'method' }, (method) => ({ kind: 'method' as const, name: method.name, optional: method.optional, signatures: method.signatures })),
    Match.when({ kind: 'accessor' }, (accessor) => ({
      kind: 'property' as const,
      name: accessor.name,
      optional: false,
      readonly: Option.isNone(accessor.set),
      type: accessorType(accessor),
    })),
    Match.exhaustive,
  )

const assembleMembers = (drafts: ReadonlyArray<Draft>): ReadonlyArray<Member> =>
  Arr.reduce<Draft, DraftState>(drafts, { ordered: [], index: HashMap.empty<string, number>() }, mergeDraft).ordered.map(finalise)

const memberPropertyOf = (context: TypeContext, member: TSPropertySignature): Effect.Effect<Member, UnsupportedDeclaration> =>
  Option.match(propertyKeyNameOf(member.key), {
    onNone: () => refuse(context.file, `a ${member.key.type} member name`),
    onSome: (name) =>
      Effect.map(annotationTypeOrDefault(context, member.typeAnnotation, 'any'), (type): Member => ({
        kind: 'property',
        name,
        optional: member.optional,
        readonly: member.readonly,
        type,
      })),
  })

const memberMethodDraftOf = (context: TypeContext, member: TSMethodSignature): Effect.Effect<Draft, UnsupportedDeclaration> =>
  Option.match(propertyKeyNameOf(member.key), {
    onNone: () => refuse(context.file, `a ${member.key.type} method name`),
    onSome: (name) =>
      Effect.map(signatureOf(context, member.typeParameters, member.params, member.returnType), (signature): Draft =>
        Match.value(member.kind).pipe(
          Match.when('get', () => ({ kind: 'accessor' as const, name, get: Option.some(signature), set: Option.none() })),
          Match.when('set', () => ({ kind: 'accessor' as const, name, get: Option.none(), set: Option.some(signature) })),
          Match.orElse(() => ({ kind: 'method' as const, name, optional: member.optional, signatures: [signature] })),
        )),
  })

const indexSignatureMemberOf = (context: TypeContext, member: TSIndexSignature): Effect.Effect<Member, UnsupportedDeclaration> =>
  Arr.match(member.parameters, {
    onEmpty: () => refuse(context.file, 'an index signature without a parameter'),
    onNonEmpty: ([parameter]) =>
      Effect.gen(function* () {
        const key = yield* canonicalTypeText(context, parameter.typeAnnotation.typeAnnotation)
        const type = yield* typeExprOf(context, member.typeAnnotation.typeAnnotation)
        return { kind: 'property' as const, name: `[key: ${key}]`, optional: false, readonly: member.readonly, type }
      }),
  })

const callSignatureOf = (context: TypeContext, member: TSCallSignatureDeclaration): Effect.Effect<Member, UnsupportedDeclaration> =>
  Effect.map(signatureOf(context, member.typeParameters, member.params, member.returnType), (signature): Member => ({ kind: 'call', signature }))

const constructSignatureOf = (context: TypeContext, member: TSConstructSignatureDeclaration): Effect.Effect<Member, UnsupportedDeclaration> =>
  Effect.map(signatureOf(context, member.typeParameters, member.params, member.returnType), (signature): Member => ({
    kind: 'method',
    name: 'new',
    optional: false,
    signatures: [signature],
  }))

const memberDraftOf = (context: TypeContext, member: TSSignature): Effect.Effect<Draft, UnsupportedDeclaration> =>
  Match.value(member).pipe(
    Match.when({ type: 'TSPropertySignature' }, (property) =>
      Effect.map(memberPropertyOf(context, property), (built): Draft => ({ kind: 'member', member: built }))),
    Match.when({ type: 'TSMethodSignature' }, (method) => memberMethodDraftOf(context, method)),
    Match.when({ type: 'TSCallSignatureDeclaration' }, (call) =>
      Effect.map(callSignatureOf(context, call), (built): Draft => ({ kind: 'member', member: built }))),
    Match.when({ type: 'TSIndexSignature' }, (index) =>
      Effect.map(indexSignatureMemberOf(context, index), (built): Draft => ({ kind: 'member', member: built }))),
    Match.when({ type: 'TSConstructSignatureDeclaration' }, (construct) =>
      Effect.map(constructSignatureOf(context, construct), (built): Draft => ({ kind: 'member', member: built }))),
    Match.orElse(() => refuse(context.file, 'an unsupported member')),
  )

const membersOf = (context: TypeContext, members: ReadonlyArray<TSSignature>): Effect.Effect<ReadonlyArray<Member>, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(members, (member) => memberDraftOf(context, member)), assembleMembers)

const ABSTRACT_ELEMENT_TYPES: ReadonlyArray<ClassElement['type']> = [
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSAbstractAccessorProperty',
]

const isAbstractElement = (type: ClassElement['type']): boolean =>
  Match.value(type).pipe(
    Match.when(Match.is(...ABSTRACT_ELEMENT_TYPES), () => true),
    Match.orElse(() => false),
  )

const accessibilityWord = (accessibility: TSAccessibility | null | undefined): ReadonlyArray<string> =>
  Match.value(accessibility).pipe(
    Match.when('private', () => ['private']),
    Match.when('protected', () => ['protected']),
    Match.orElse(() => []),
  )

const flagWord = (flag: boolean, word: string): ReadonlyArray<string> => (flag ? [word] : [])

const modifierWords = (
  accessibility: TSAccessibility | null | undefined,
  isStatic: boolean,
  isAbstract: boolean,
): ReadonlyArray<string> => [...accessibilityWord(accessibility), ...flagWord(isStatic, 'static'), ...flagWord(isAbstract, 'abstract')]

const prefixedName = (words: ReadonlyArray<string>, name: string): string =>
  Match.value(Arr.join(words, ' ')).pipe(
    Match.when('', () => name),
    Match.orElse((modifiers) => `${modifiers} ${name}`),
  )

const accessibleName = (
  key: PropertyKey,
  accessibility: TSAccessibility | null | undefined,
  isStatic: boolean,
  isAbstract: boolean,
): Option.Option<string> =>
  Match.value(accessibility).pipe(
    Match.when('private', () => Option.none()),
    Match.orElse(() =>
      Option.map(propertyKeyNameOf(key), (name) => prefixedName(modifierWords(accessibility, isStatic, isAbstract), name)),
    ),
  )

const classMethodName = (method: MethodDefinition): Option.Option<string> =>
  Match.value(method).pipe(
    Match.when({ kind: 'constructor' }, (constructor) =>
      Option.some(prefixedName(accessibilityWord(constructor.accessibility), 'constructor')),
    ),
    Match.orElse(() => accessibleName(method.key, method.accessibility, method.static, isAbstractElement(method.type))),
  )

const classMethodDraftOf = (context: TypeContext, method: MethodDefinition): Effect.Effect<Option.Option<Draft>, UnsupportedDeclaration> =>
  Option.match(classMethodName(method), {
    onNone: () => Effect.succeedNone,
    onSome: (name) =>
      Effect.asSome(Effect.map(signatureOf(context, method.value.typeParameters, method.value.params, method.value.returnType), (signature): Draft =>
        Match.value(method.kind).pipe(
          Match.when('constructor', () => ({ kind: 'method' as const, name, optional: false, signatures: [signature] })),
          Match.when('method', () => ({ kind: 'method' as const, name, optional: method.optional ?? false, signatures: [signature] })),
          Match.when('get', () => ({ kind: 'accessor' as const, name, get: Option.some(signature), set: Option.none() })),
          Match.orElse(() => ({ kind: 'accessor' as const, name, get: Option.none(), set: Option.some(signature) })),
        ))),
  })

const optionalFlag = (optional: boolean | undefined): boolean => optional ?? false
const readonlyFlag = (readonly: boolean | undefined): boolean => readonly ?? false

const propertyDraft = (name: string, property: PropertyDefinition, type: TypeExpr): Draft => ({
  kind: 'member',
  member: {
    kind: 'property',
    name,
    optional: optionalFlag(property.optional),
    readonly: readonlyFlag(property.readonly),
    type,
  },
})

const classPropertyDraftOf = (context: TypeContext, property: PropertyDefinition): Effect.Effect<Option.Option<Draft>, UnsupportedDeclaration> =>
  Option.match(accessibleName(property.key, property.accessibility, property.static, isAbstractElement(property.type)), {
    onNone: () => Effect.succeedNone,
    onSome: (name) =>
      Effect.asSome(Effect.map(annotationTypeOrDefault(context, property.typeAnnotation, 'any'), (type) => propertyDraft(name, property, type))),
  })

const classAccessorDraftOf = (context: TypeContext, accessor: AccessorProperty): Effect.Effect<Option.Option<Draft>, UnsupportedDeclaration> =>
  Option.match(accessibleName(accessor.key, accessor.accessibility, accessor.static, isAbstractElement(accessor.type)), {
    onNone: () => Effect.succeedNone,
    onSome: (name) =>
      Effect.asSome(Effect.map(annotationTypeOrDefault(context, accessor.typeAnnotation, 'any'), (type): Draft => ({
        kind: 'member',
        member: { kind: 'property', name, optional: false, readonly: false, type },
      }))),
  })

const classElementDraftOf = (context: TypeContext, element: ClassElement): Effect.Effect<Option.Option<Draft>, UnsupportedDeclaration> =>
  Match.value(element).pipe(
    Match.when({ type: 'StaticBlock' }, () => Effect.succeedNone),
    Match.when({ type: Match.is('MethodDefinition', 'TSAbstractMethodDefinition') }, (method) => classMethodDraftOf(context, method)),
    Match.when({ type: Match.is('PropertyDefinition', 'TSAbstractPropertyDefinition') }, (property) => classPropertyDraftOf(context, property)),
    Match.when({ type: Match.is('AccessorProperty', 'TSAbstractAccessorProperty') }, (accessor) => classAccessorDraftOf(context, accessor)),
    Match.when({ type: 'TSIndexSignature' }, (index) =>
      Effect.asSome(Effect.map(indexSignatureMemberOf(context, index), (member): Draft => ({ kind: 'member', member })))),
    Match.orElse(() => refuse(context.file, 'an unsupported class member')),
  )

const classMembersOf = (
  context: TypeContext,
  elements: ReadonlyArray<ClassElement>,
): Effect.Effect<ReadonlyArray<Member>, UnsupportedDeclaration> =>
  Effect.map(
    Effect.forEach(elements, (element) => classElementDraftOf(context, element)),
    (drafts) => assembleMembers(Arr.getSomes(drafts)),
  )

const plainTupleElement = (element: TSTupleElement): Option.Option<TSType> =>
  Match.value(element).pipe(
    Match.when({ type: Match.is('TSNamedTupleMember', 'TSOptionalType', 'TSRestType') }, () => Option.none()),
    Match.orElse((type) => Option.some(type)),
  )

const plainElements = (elements: ReadonlyArray<TSTupleElement>): Option.Option<ReadonlyArray<TSType>> => {
  const mapped = elements.map(plainTupleElement)
  return Arr.every(mapped, Option.isSome) ? Option.some(Arr.getSomes(mapped)) : Option.none()
}

const readonlyOperatorExpr = (context: TypeContext, node: TSTypeOperator): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Match.value(node.typeAnnotation).pipe(
    Match.when({ type: 'TSArrayType' }, (array) =>
      Effect.map(typeExprOf(context, array.elementType), (element): TypeExpr => ({ kind: 'array', readonly: true, element }))),
    Match.when({ type: 'TSTupleType' }, (tuple) =>
      Option.match(plainElements(tuple.elementTypes), {
        onNone: () => textExpr(context, node),
        onSome: (types) =>
          Effect.map(Effect.forEach(types, (type) => typeExprOf(context, type)), (resolved): TypeExpr => ({ kind: 'tuple', readonly: true, elements: resolved })),
      })),
    Match.orElse(() => textExpr(context, node)),
  )

const operatorExpr = (context: TypeContext, node: TSTypeOperator): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Match.value(node.operator).pipe(
    Match.when('readonly', () => readonlyOperatorExpr(context, node)),
    Match.orElse(() => textExpr(context, node)),
  )

const objectMemberIsPlain = (member: TSSignature): boolean =>
  Match.value(member.type).pipe(
    Match.when(Match.is('TSPropertySignature', 'TSMethodSignature', 'TSCallSignatureDeclaration'), () => true),
    Match.orElse(() => false),
  )

const objectExpr = (context: TypeContext, literal: TSTypeLiteral): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Arr.every(literal.members, objectMemberIsPlain)
    ? Effect.map(membersOf(context, literal.members), (members): TypeExpr => normaliseType({ kind: 'object', members }))
    : textExpr(context, literal)

const unionExpr = (
  context: TypeContext,
  kind: 'union' | 'intersection',
  members: ReadonlyArray<TSType>,
): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Effect.map(Effect.forEach(members, (member) => typeExprOf(context, member)), (resolved): TypeExpr => normaliseType({ kind, members: resolved }))

const typeExprOf = (context: TypeContext, node: TSType): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Match.value(node).pipe(
    Match.when({ type: Match.is(...KEYWORD_NODE_NAMES) }, (keyword) =>
      Effect.succeed<TypeExpr>({ kind: 'keyword', name: Option.getOrThrow(keywordNameOf(keyword.type)) })),
    Match.when({ type: 'TSThisType' }, () => Effect.succeed(referenceExpr('this', Option.none(), []))),
    Match.when({ type: 'TSLiteralType' }, (literal) => literalExpr(context, literal)),
    Match.when({ type: 'TSTypeReference' }, (reference) =>
      referenceTypeOf(context, { targetContext: context, segments: nameSegments(reference.typeName), source: Option.none() }, reference.typeArguments)),
    Match.when({ type: 'TSImportType' }, (imported) =>
      Arr.match(importSegments(imported.qualifier), {
        onEmpty: () => textExpr(context, imported),
        onNonEmpty: (segments) =>
          referenceTypeOf(context, { targetContext: context, segments, source: Option.some(imported.source.value) }, imported.typeArguments),
      })),
    Match.when({ type: 'TSUnionType' }, (union) => unionExpr(context, 'union', union.types)),
    Match.when({ type: 'TSIntersectionType' }, (intersection) => unionExpr(context, 'intersection', intersection.types)),
    Match.when({ type: 'TSParenthesizedType' }, (parenthesised) => typeExprOf(context, parenthesised.typeAnnotation)),
    Match.when({ type: 'TSArrayType' }, (array) =>
      Effect.map(typeExprOf(context, array.elementType), (element): TypeExpr => ({ kind: 'array', readonly: false, element }))),
    Match.when({ type: 'TSTypeOperator' }, (operator) => operatorExpr(context, operator)),
    Match.when({ type: 'TSTupleType' }, (tuple) =>
      Option.match(plainElements(tuple.elementTypes), {
        onNone: () => textExpr(context, tuple),
        onSome: (types) =>
          Effect.map(Effect.forEach(types, (type) => typeExprOf(context, type)), (elements): TypeExpr => ({ kind: 'tuple', readonly: false, elements })),
      })),
    Match.when({ type: 'TSFunctionType' }, (function_) =>
      Effect.map(signatureOf(context, function_.typeParameters, function_.params, function_.returnType), (signature): TypeExpr => ({ kind: 'function', signature }))),
    Match.when({ type: 'TSTypeLiteral' }, (literal) => objectExpr(context, literal)),
    Match.orElse((other) => textExpr(context, other)),
  )

const literalExpr = (context: TypeContext, node: TSLiteralType): Effect.Effect<TypeExpr, UnsupportedDeclaration> =>
  Option.match(literalTextOf(node.literal), {
    onNone: () => textExpr(context, node),
    onSome: (text) => Effect.succeed<TypeExpr>({ kind: 'literal', text }),
  })

export const TypeExprs: {
  readonly typeExprOf: (context: TypeContext, node: TSType) => Effect.Effect<TypeExpr, UnsupportedDeclaration>
  readonly typeParametersOf: (
    context: TypeContext,
    declaration: TSTypeParameterDeclaration | null | undefined,
  ) => Effect.Effect<ReadonlyArray<TypeParameter>, UnsupportedDeclaration>
  readonly signatureOf: (
    context: TypeContext,
    typeParameters: TSTypeParameterDeclaration | null | undefined,
    params: ReadonlyArray<ParamPattern>,
    returnType: TSTypeAnnotation | null | undefined,
  ) => Effect.Effect<Signature, UnsupportedDeclaration>
  readonly superClassOf: (
    context: TypeContext,
    expression: Expression,
    typeArguments: TSTypeParameterInstantiation | null | undefined,
  ) => Effect.Effect<TypeExpr, UnsupportedDeclaration>
  readonly heritageOf: (context: TypeContext, heritage: TSInterfaceHeritage | TSClassImplements) => Effect.Effect<TypeExpr, UnsupportedDeclaration>
  readonly membersOf: (context: TypeContext, members: ReadonlyArray<TSSignature>) => Effect.Effect<ReadonlyArray<Member>, UnsupportedDeclaration>
  readonly classMembersOf: (context: TypeContext, elements: ReadonlyArray<ClassElement>) => Effect.Effect<ReadonlyArray<Member>, UnsupportedDeclaration>
} = {
  typeExprOf: typeExprOf,
  typeParametersOf: typeParametersOf,
  signatureOf: signatureOf,
  superClassOf: superClassOf,
  heritageOf: heritageOf,
  membersOf: membersOf,
  classMembersOf: classMembersOf,
}
