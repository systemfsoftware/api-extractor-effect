import { Array as Arr, Function, Order, Schema } from 'effect'
import { canonicalKey } from '../canonical-json.schema.ts'
import type {
  ApiItem,
  ApiModel,
  ClassItem,
  EntryPoint,
  EnumItem,
  EnumMember,
  FunctionItem,
  InterfaceItem,
  NamespaceItem,
  TypeAliasItem,
  VariableItem,
} from '../model/api-model.schema.ts'
import {
  type ArrayType,
  type FunctionType,
  type Member,
  type MethodMember,
  normaliseType,
  type ObjectType,
  type Parameter,
  type PropertyMember,
  type Signature,
  type TupleType,
  type TypeExpr,
  type TypeParameter,
  typeKey,
} from '../model/type-expr.schema.ts'
import { type Direction, direction } from './direction.schema.ts'
import { type ChannelType, compose, flip, type Position } from './position.schema.ts'

const CHANGE_KINDS = [
  'entry-point-added',
  'entry-point-removed',
  'export-added',
  'export-removed',
  'export-kind-changed',
  'overload-added',
  'overload-removed',
  'dual-form-added',
  'dual-form-removed',
  'required-parameter-added',
  'optional-parameter-added',
  'parameter-removed',
  'parameter-became-optional',
  'parameter-became-required',
  'parameter-rest-changed',
  'required-member-added',
  'optional-member-added',
  'member-removed',
  'member-kind-changed',
  'member-became-optional',
  'member-became-required',
  'member-became-readonly',
  'member-became-mutable',
  'type-parameters-changed',
  'heritage-changed',
  'variable-mutability-changed',
  'class-became-abstract',
  'class-became-concrete',
  'enum-member-added',
  'enum-member-removed',
  'enum-member-value-changed',
  'enum-const-changed',
  'type-changed',
] as const

export const ChangeKind: Schema.Literals<typeof CHANGE_KINDS> = Schema.Literals(CHANGE_KINDS)
export type ChangeKind = typeof ChangeKind.Type

/** One difference between two models, before any rule judges it. */
export type Change = {
  readonly kind: ChangeKind
  readonly location: string
  readonly position: Position
  /** The Effect-family channel (`A`, `E`, `R`, ...) the change sits under, if any. */
  readonly channel?: string
  readonly direction?: Direction
}

export type Changes = ReadonlyArray<Change>

type Aliases = ReadonlyMap<string, TypeAliasItem>

interface At {
  readonly position: Position
  readonly location: string
  readonly channel?: string
}

interface Context {
  readonly channelTypes: ReadonlyArray<ChannelType>
}

const channelField = (channel: string | undefined): Partial<Change> => (channel === undefined ? {} : { channel })

const change = (kind: ChangeKind, at: At, extra: Partial<Change> = {}): Change => ({
  kind,
  location: at.location,
  position: at.position,
  ...channelField(at.channel),
  ...extra,
})

const step = (at: At, segment: string, position: Position = at.position): At => ({
  ...at,
  position,
  location: `${at.location}/${segment}`,
})

interface Scope {
  readonly aliases: Aliases
  readonly bindings: ReadonlyMap<string, TypeExpr>
  readonly expanding: ReadonlySet<string>
}

const without = <V>(map: ReadonlyMap<string, V>, names: ReadonlyArray<string>): ReadonlyMap<string, V> =>
  names.some((name) => map.has(name)) ? new Map([...map].filter(([key]) => !names.includes(key))) : map

const unknownKeyword: TypeExpr = { kind: 'keyword', name: 'unknown' }

type Reference = TypeExpr & { readonly kind: 'reference' }

const expandType = (type: TypeExpr, scope: Scope): TypeExpr => {
  switch (type.kind) {
    case 'reference':
      return expandReference(type, scope)
    case 'union':
    case 'intersection':
      return normaliseType({ kind: type.kind, members: type.members.map((member) => expandType(member, scope)) })
    case 'array':
      return { ...type, element: expandType(type.element, scope) }
    case 'tuple':
      return { ...type, elements: type.elements.map((element) => expandType(element, scope)) }
    case 'function':
      return { kind: 'function', signature: expandSignature(type.signature, scope) }
    case 'object':
      return { kind: 'object', members: type.members.map((member) => expandMember(member, scope)) }
    case 'keyword':
    case 'literal':
    case 'text':
      return type
  }
}

const bareReference = (type: Reference): boolean => type.module === undefined && type.args.length === 0

const boundType = (type: Reference, scope: Scope): TypeExpr | undefined =>
  bareReference(type) ? scope.bindings.get(type.name) : undefined

const expandReference = (type: Reference, scope: Scope): TypeExpr =>
  boundType(type, scope) ?? expandReferenceArgs(type, scope)

const expandReferenceArgs = (type: Reference, scope: Scope): TypeExpr => {
  const args = type.args.map((arg) => expandType(arg, scope))
  const alias = scope.aliases.get(type.name)
  return type.module === undefined ? expandAliasOrArgs(alias, type, args, scope) : { ...type, args }
}

const expandAliasOrArgs = (
  alias: TypeAliasItem | undefined,
  type: Reference,
  args: ReadonlyArray<TypeExpr>,
  scope: Scope,
): TypeExpr => (alias === undefined ? { ...type, args } : expandAdmittedAlias(alias, type, args, scope))

const expandAdmittedAlias = (
  alias: TypeAliasItem,
  type: Reference,
  args: ReadonlyArray<TypeExpr>,
  scope: Scope,
): TypeExpr => (scope.expanding.has(type.name) ? { ...type, args } : expandAlias(alias, type, args, scope))

const expandAlias = (alias: TypeAliasItem, type: Reference, args: ReadonlyArray<TypeExpr>, scope: Scope): TypeExpr => {
  const expanding = new Set([...scope.expanding, type.name])
  const bindings = alias.typeParameters.reduce<ReadonlyMap<string, TypeExpr>>(
    (bound, parameter, index) => bindParameter(bound, parameter, args[index], { scope, expanding }),
    new Map(),
  )
  return expandType(alias.type, { aliases: scope.aliases, bindings, expanding })
}

type Expansion = { readonly scope: Scope; readonly expanding: ReadonlySet<string> }

const bindParameter = (
  bound: ReadonlyMap<string, TypeExpr>,
  parameter: TypeParameter,
  arg: TypeExpr | undefined,
  expansion: Expansion,
): ReadonlyMap<string, TypeExpr> => new Map([...bound, [parameter.name, argumentOrDefault(bound, parameter, arg, expansion)]])

const argumentOrDefault = (
  bound: ReadonlyMap<string, TypeExpr>,
  parameter: TypeParameter,
  arg: TypeExpr | undefined,
  expansion: Expansion,
): TypeExpr => arg ?? defaultArgument(bound, parameter, expansion)

const defaultArgument = (
  bound: ReadonlyMap<string, TypeExpr>,
  parameter: TypeParameter,
  { scope, expanding }: Expansion,
): TypeExpr => {
  const fallback = parameter.default
  if (fallback === undefined) return unknownKeyword
  return expandType(fallback, { aliases: scope.aliases, bindings: bound, expanding })
}

const expandTypeParameters = (parameters: ReadonlyArray<TypeParameter>, scope: Scope): ReadonlyArray<TypeParameter> =>
  parameters.map((parameter) => expandTypeParameter(parameter, scope))

const modifierFields = (parameter: TypeParameter): Pick<TypeParameter, 'modifiers'> =>
  parameter.modifiers === undefined ? {} : { modifiers: parameter.modifiers }

const expandTypeParameter = (parameter: TypeParameter, scope: Scope): TypeParameter => ({
  name: parameter.name,
  ...modifierFields(parameter),
  ...constraintOf(parameter, scope),
  ...defaultOf(parameter, scope),
})

const constraintOf = (parameter: TypeParameter, scope: Scope): Partial<TypeParameter> =>
  parameter.constraint === undefined ? {} : { constraint: expandType(parameter.constraint, scope) }

const defaultOf = (parameter: TypeParameter, scope: Scope): Partial<TypeParameter> =>
  parameter.default === undefined ? {} : { default: expandType(parameter.default, scope) }

const enterTypeParameters = (scope: Scope, parameters: ReadonlyArray<TypeParameter>): Scope => {
  const names = parameters.map((parameter) => parameter.name)
  return { ...scope, aliases: without(scope.aliases, names), bindings: without(scope.bindings, names) }
}

const expandSignature = (signature: Signature, outer: Scope): Signature => {
  const scope = enterTypeParameters(outer, signature.typeParameters)
  return {
    typeParameters: expandTypeParameters(signature.typeParameters, scope),
    parameters: signature.parameters.map((parameter) => ({ ...parameter, type: expandType(parameter.type, scope) })),
    returns: expandType(signature.returns, scope),
  }
}

const expandMember = (member: Member, scope: Scope): Member => {
  switch (member.kind) {
    case 'property':
      return { ...member, type: expandType(member.type, scope) }
    case 'method':
      return { ...member, signatures: member.signatures.map((signature) => expandSignature(signature, scope)) }
    case 'call':
      return { kind: 'call', signature: expandSignature(member.signature, scope) }
  }
}

const expandItem = (item: ApiItem, scope: Scope): ApiItem => {
  switch (item.kind) {
    case 'function':
      return { ...item, signatures: item.signatures.map((signature) => expandSignature(signature, scope)) }
    case 'variable':
      return { ...item, type: expandType(item.type, scope) }
    case 'typeAlias': {
      const inner = enterTypeParameters({ ...scope, expanding: new Set([...scope.expanding, item.name]) }, item.typeParameters)
      return { ...item, typeParameters: expandTypeParameters(item.typeParameters, inner), type: expandType(item.type, inner) }
    }
    case 'interface':
    case 'class': {
      const inner = enterTypeParameters(scope, item.typeParameters)
      return {
        ...item,
        typeParameters: expandTypeParameters(item.typeParameters, inner),
        members: item.members.map((member) => expandMember(member, inner)),
      }
    }
    case 'enum':
      return item
    case 'namespace':
      return { ...item, items: item.items.map((child) => expandItem(child, scope)) }
  }
}

type ChannelSlot = ChannelType['channels'][number]

const namesInclude = (candidate: ChannelType, type: Reference): boolean => candidate.names.includes(type.name)

const moduleMatches = (candidate: ChannelType, type: Reference): boolean =>
  type.module === undefined || candidate.modules.includes(type.module)

const arityFits = (candidate: ChannelType, type: Reference): boolean => type.args.length <= candidate.channels.length

const omittedSlotsHaveDefaults = (candidate: ChannelType, type: Reference): boolean =>
  candidate.channels.slice(type.args.length).every((slot) => slot.default !== undefined)

const spells = (candidate: ChannelType, type: Reference): boolean =>
  [namesInclude, moduleMatches, arityFits, omittedSlotsHaveDefaults].every((predicate) => predicate(candidate, type))

const channelTypeOf = (context: Context, type: Reference): ChannelType | undefined =>
  context.channelTypes.find((candidate) => spells(candidate, type))

const slotDefault = (slot: ChannelSlot): TypeExpr => slot.default ?? unknownKeyword

const channelArg = (slot: ChannelSlot, arg: TypeExpr | undefined): TypeExpr => arg ?? slotDefault(slot)

const channelArgs = (channelType: ChannelType, type: Reference): ReadonlyArray<TypeExpr> =>
  channelType.channels.map((slot, index) => channelArg(slot, type.args[index]))

const compareChannelArgs = (
  context: Context,
  channelType: ChannelType,
  b: Reference,
  a: Reference,
  at: At,
): ReadonlyArray<Change> => {
  const from = channelArgs(channelType, b)
  const to = channelArgs(channelType, a)
  return Arr.zip(channelType.channels, Arr.zip(from, to)).flatMap(([slot, [fromType, toType]]) =>
    compareType(context, fromType, toType, {
      position: compose(at.position, slot.variance),
      location: `${at.location}/${slot.name}`,
      channel: slot.name,
    }),
  )
}

const changedType = (b: TypeExpr, a: TypeExpr, at: At): ReadonlyArray<Change> => {
  const moved = direction(b, a)
  return moved === undefined ? [] : [change('type-changed', at, { direction: moved })]
}

const isReference = (type: TypeExpr): type is Reference => type.kind === 'reference'
const isFunctionType = (type: TypeExpr): type is FunctionType => type.kind === 'function'
const isObjectType = (type: TypeExpr): type is ObjectType => type.kind === 'object'
const isArrayType = (type: TypeExpr): type is ArrayType => type.kind === 'array'
const isTupleType = (type: TypeExpr): type is TupleType => type.kind === 'tuple'

const compareType = (context: Context, before: TypeExpr, after: TypeExpr, at: At): ReadonlyArray<Change> => {
  const b = normaliseType(before)
  const a = normaliseType(after)
  return canonicalKey(b) === canonicalKey(a) ? [] : compareNormalised(context, b, a, at)
}

const compareNormalised = (context: Context, b: TypeExpr, a: TypeExpr, at: At): ReadonlyArray<Change> => {
  switch (b.kind) {
    case 'reference':
      return compareReference(context, b, a, at)
    case 'function':
      return compareFunctionType(context, b, a, at)
    case 'object':
      return compareObjectType(context, b, a, at)
    case 'array':
      return compareArrayType(context, b, a, at)
    case 'tuple':
      return compareTupleType(context, b, a, at)
    case 'union':
    case 'intersection':
    case 'keyword':
    case 'literal':
    case 'text':
      return changedType(b, a, at)
  }
}

const compareReference = (context: Context, b: Reference, a: TypeExpr, at: At): ReadonlyArray<Change> =>
  isReference(a) ? compareReferencePair(context, b, a, at) : changedType(b, a, at)

const sameReferenceShape = (b: Reference, a: Reference): boolean => b.name === a.name && b.module === a.module

const compareReferencePair = (context: Context, b: Reference, a: Reference, at: At): ReadonlyArray<Change> =>
  sameReferenceShape(b, a) ? compareShapedReference(context, b, a, at) : changedType(b, a, at)

const compareShapedReference = (context: Context, b: Reference, a: Reference, at: At): ReadonlyArray<Change> =>
  channelChanges(context, b, a, at) ?? argumentChanges(context, b, a, at)

const channelChanges = (context: Context, b: Reference, a: Reference, at: At): ReadonlyArray<Change> | undefined =>
  channelTypeChanges(context, b, a, channelTypeOf(context, a), at)

const channelTypeChanges = (
  context: Context,
  b: Reference,
  a: Reference,
  other: ChannelType | undefined,
  at: At,
): ReadonlyArray<Change> | undefined => (other === undefined ? undefined : matchingChannelChanges(context, b, a, other, at))

const matchingChannelChanges = (
  context: Context,
  b: Reference,
  a: Reference,
  channelType: ChannelType,
  at: At,
): ReadonlyArray<Change> | undefined =>
  channelTypeOf(context, b) === channelType ? compareChannelArgs(context, channelType, b, a, at) : undefined

const argumentChanges = (context: Context, b: Reference, a: Reference, at: At): ReadonlyArray<Change> =>
  b.args.length === a.args.length ? compareArguments(context, b.args, a.args, at) : changedType(b, a, at)

const compareArguments = (
  context: Context,
  left: ReadonlyArray<TypeExpr>,
  right: ReadonlyArray<TypeExpr>,
  at: At,
): ReadonlyArray<Change> =>
  Arr.zip(left, right).flatMap(([argument, other], index) => compareType(context, argument, other, step(at, `arg[${index}]`, 'both')))

const compareFunctionType = (context: Context, b: FunctionType, a: TypeExpr, at: At): ReadonlyArray<Change> =>
  isFunctionType(a) ? compareSignature(context, b.signature, a.signature, at) : changedType(b, a, at)

const compareObjectType = (context: Context, b: ObjectType, a: TypeExpr, at: At): ReadonlyArray<Change> =>
  isObjectType(a) ? compareMembers(context, b.members, a.members, at) : changedType(b, a, at)

const compareArrayType = (context: Context, b: ArrayType, a: TypeExpr, at: At): ReadonlyArray<Change> =>
  isArrayType(a) ? compareSameArray(context, b, a, at) : changedType(b, a, at)

const compareSameArray = (context: Context, b: ArrayType, a: ArrayType, at: At): ReadonlyArray<Change> =>
  b.readonly === a.readonly ? compareType(context, b.element, a.element, step(at, 'element')) : changedType(b, a, at)

const compareTupleType = (context: Context, b: TupleType, a: TypeExpr, at: At): ReadonlyArray<Change> =>
  isTupleType(a) ? compareSameTuple(context, b, a, at) : changedType(b, a, at)

const comparableTuple = (b: TupleType, a: TupleType): boolean =>
  b.readonly === a.readonly && b.elements.length === a.elements.length

const compareSameTuple = (context: Context, b: TupleType, a: TupleType, at: At): ReadonlyArray<Change> =>
  comparableTuple(b, a) ? compareTupleElements(context, b.elements, a.elements, at) : changedType(b, a, at)

const compareTupleElements = (
  context: Context,
  left: ReadonlyArray<TypeExpr>,
  right: ReadonlyArray<TypeExpr>,
  at: At,
): ReadonlyArray<Change> =>
  Arr.zip(left, right).flatMap(([element, other], index) =>
    compareType(context, element, other, step(at, `element[${index}]`)),
  )

const optionalTypeKey = (type: TypeExpr | undefined): string | null => (type === undefined ? null : typeKey(type))

const typeParameterKey = (parameter: TypeParameter) => ({
  name: parameter.name,
  constraint: optionalTypeKey(parameter.constraint),
  default: optionalTypeKey(parameter.default),
  modifiers: parameter.modifiers ?? [],
})

const typeParametersKey = (parameters: ReadonlyArray<TypeParameter>): string =>
  canonicalKey(parameters.map(typeParameterKey))

const becameRequired = (before: { readonly optional: boolean }, after: { readonly optional: boolean }): boolean =>
  before.optional && !after.optional

const becameOptional = (before: { readonly optional: boolean }, after: { readonly optional: boolean }): boolean =>
  !before.optional && after.optional

const restChanged = (before: Parameter, after: Parameter): boolean => before.rest !== after.rest

const flagChange = (condition: boolean, kind: ChangeKind, at: At): ReadonlyArray<Change> =>
  condition ? [change(kind, at)] : []

const compareParameter = (
  context: Context,
  before: Parameter,
  after: Parameter,
  at: At,
): ReadonlyArray<Change> => {
  const flags: ReadonlyArray<Change> = [
    ...flagChange(becameRequired(before, after), 'parameter-became-required', at),
    ...flagChange(becameOptional(before, after), 'parameter-became-optional', at),
    ...flagChange(restChanged(before, after), 'parameter-rest-changed', at),
  ]
  return [...flags, ...compareType(context, before.type, after.type, { ...at, position: flip(at.position) })]
}

const typeParametersChanged = (
  before: { readonly typeParameters: ReadonlyArray<TypeParameter> },
  after: { readonly typeParameters: ReadonlyArray<TypeParameter> },
): boolean => typeParametersKey(before.typeParameters) !== typeParametersKey(after.typeParameters)

const optionalParameter = (parameter: Parameter): boolean => parameter.optional || parameter.rest

const addedParameterKind = (parameter: Parameter): ChangeKind =>
  optionalParameter(parameter) ? 'optional-parameter-added' : 'required-parameter-added'

const compareSignature = (
  context: Context,
  before: Signature,
  after: Signature,
  at: At,
): ReadonlyArray<Change> => {
  const typeParameters = flagChange(typeParametersChanged(before, after), 'type-parameters-changed', at)
  const shared = Math.min(before.parameters.length, after.parameters.length)
  const parameters = Arr.zip(before.parameters.slice(0, shared), after.parameters.slice(0, shared)).flatMap(
    ([parameter, other], index) => compareParameter(context, parameter, other, step(at, `parameter[${index}]`)),
  )
  const added = after.parameters
    .slice(shared)
    .map((parameter, offset) => change(addedParameterKind(parameter), step(at, `parameter[${shared + offset}]`)))
  const removed = before.parameters
    .slice(shared)
    .map((_, offset) => change('parameter-removed', step(at, `parameter[${shared + offset}]`)))
  const returns = compareType(context, before.returns, after.returns, step(at, 'returns'))
  return [...typeParameters, ...parameters, ...added, ...removed, ...returns]
}

type Form = 'data-first' | 'data-last' | 'plain'

const formsOf = (signatures: ReadonlyArray<Signature>): ReadonlyArray<Form> =>
  signatures.map((signature) => formOf(signatures, signature))

const formOf = (signatures: ReadonlyArray<Signature>, signature: Signature): Form =>
  hasDataLastPartner(signatures, signature) ? 'data-last' : dataFirstOrPlain(signatures, signature)

const dataFirstOrPlain = (signatures: ReadonlyArray<Signature>, signature: Signature): Form =>
  hasDataFirstPartner(signatures, signature) ? 'data-first' : 'plain'

const isDataLast = (signature: Signature): boolean =>
  signature.returns.kind === 'function' && signature.returns.signature.parameters.length === 1

const hasDataLastPartner = (signatures: ReadonlyArray<Signature>, signature: Signature): boolean =>
  isDataLast(signature) && signatures.some((other) => partnership(other, signature))

const hasDataFirstPartner = (signatures: ReadonlyArray<Signature>, signature: Signature): boolean =>
  signatures.some((other) => dataLastPartner(other, signature))

const partnership = (other: Signature, signature: Signature): boolean => other !== signature && partners(other, signature)

const distinctDataLast = (other: Signature, signature: Signature): boolean => other !== signature && isDataLast(other)

const dataLastPartner = (other: Signature, signature: Signature): boolean =>
  distinctDataLast(other, signature) && partners(signature, other)

const firstParameter = (parameters: ReadonlyArray<Parameter>): Parameter => {
  const [parameter] = parameters
  if (parameter === undefined) throw new Error('a dual signature needs a first parameter')
  return parameter
}

const arityMatches = (dataFirst: ReadonlyArray<Parameter>, dataLast: ReadonlyArray<Parameter>): boolean =>
  dataFirst.length === dataLast.length + 1

const firstTypesMatch = (dataFirst: ReadonlyArray<Parameter>, dataLast: ReadonlyArray<Parameter>): boolean =>
  typeKey(firstParameter(dataFirst).type) === typeKey(firstParameter(dataLast).type)

const matchingPartner = (dataFirst: Signature, dataLast: Signature, dataLastReturns: Signature): boolean =>
  arityMatches(dataFirst.parameters, dataLast.parameters) && firstTypesMatch(dataFirst.parameters, dataLastReturns.parameters)

const partners = (dataFirst: Signature, dataLast: Signature): boolean =>
  dataLast.returns.kind === 'function' && matchingPartner(dataFirst, dataLast, dataLast.returns.signature)

const signatureKey = (signature: Signature): string => canonicalKey(signature)

interface SignatureEntry {
  readonly signature: Signature
  readonly index: number
  readonly form: Form
  readonly key: string
}

const formOrder: ReadonlyArray<Form> = ['data-first', 'data-last', 'plain']

interface SignatureContext {
  readonly context: Context
  readonly beforeForms: ReadonlyArray<Form>
  readonly afterForms: ReadonlyArray<Form>
  readonly at: At
}

const signatureEntries = (
  signatures: ReadonlyArray<Signature>,
  forms: ReadonlyArray<Form>,
  keys: ReadonlyArray<string>,
): ReadonlyArray<SignatureEntry> =>
  Arr.zip(signatures, Arr.zip(forms, keys)).map(([signature, [form, key]], index) => ({ signature, index, form, key }))

const unmatchedSignatures = (
  signatures: ReadonlyArray<Signature>,
  forms: ReadonlyArray<Form>,
  keys: ReadonlyArray<string>,
  others: ReadonlySet<string>,
): ReadonlyArray<SignatureEntry> =>
  signatureEntries(signatures, forms, keys).filter((entry) => !others.has(entry.key))

const isDualForm = (form: Form): boolean => form !== 'plain'

const dualGone = (form: Form, otherForms: ReadonlyArray<Form>): boolean => isDualForm(form) && !otherForms.includes(form)

const removedSignatureKind = (form: Form, otherForms: ReadonlyArray<Form>): ChangeKind =>
  dualGone(form, otherForms) ? 'dual-form-removed' : 'overload-removed'

const addedSignatureKind = (form: Form, otherForms: ReadonlyArray<Form>): ChangeKind =>
  dualGone(form, otherForms) ? 'dual-form-added' : 'overload-added'

const formChanges = (
  form: Form,
  left: ReadonlyArray<SignatureEntry>,
  right: ReadonlyArray<SignatureEntry>,
  signatureContext: SignatureContext,
): ReadonlyArray<Change> => {
  const l = left.filter((entry) => entry.form === form)
  const r = right.filter((entry) => entry.form === form)
  const paired = Arr.zip(l.slice(0, r.length), r).flatMap(([entry, other]) =>
    compareSignature(
      signatureContext.context,
      entry.signature,
      other.signature,
      step(signatureContext.at, `signature[${entry.index}]`),
    ),
  )
  const removed = l
    .slice(r.length)
    .map((entry) =>
      change(removedSignatureKind(form, signatureContext.afterForms), step(signatureContext.at, `signature[${entry.index}]`)),
    )
  const added = r
    .slice(l.length)
    .map((entry) =>
      change(addedSignatureKind(form, signatureContext.beforeForms), step(signatureContext.at, `signature[${entry.index}]`)),
    )
  return [...paired, ...removed, ...added]
}

const compareSignatureSets = (
  context: Context,
  before: ReadonlyArray<Signature>,
  after: ReadonlyArray<Signature>,
  at: At,
): ReadonlyArray<Change> => {
  const beforeForms = formsOf(before)
  const afterForms = formsOf(after)
  const beforeKeys = before.map(signatureKey)
  const afterKeys = after.map(signatureKey)
  const left = unmatchedSignatures(before, beforeForms, beforeKeys, new Set(afterKeys))
  const right = unmatchedSignatures(after, afterForms, afterKeys, new Set(beforeKeys))
  return formOrder.flatMap((form) => formChanges(form, left, right, { context, beforeForms, afterForms, at }))
}

type NamedMember = PropertyMember | MethodMember

const memberKindChanged = (member: NamedMember, next: NamedMember): boolean => member.kind !== next.kind

const optionalityChanges = (member: NamedMember, next: NamedMember, at: At): ReadonlyArray<Change> => [
  ...flagChange(becameRequired(member, next), 'member-became-required', at),
  ...flagChange(becameOptional(member, next), 'member-became-optional', at),
]

const becameReadonly = (member: PropertyMember, next: PropertyMember): boolean => !member.readonly && next.readonly

const becameMutable = (member: PropertyMember, next: PropertyMember): boolean => member.readonly && !next.readonly

const mutabilityChanges = (member: PropertyMember, next: PropertyMember, at: At): ReadonlyArray<Change> => [
  ...flagChange(becameReadonly(member, next), 'member-became-readonly', at),
  ...flagChange(becameMutable(member, next), 'member-became-mutable', at),
]

const propertyPairChanges = (context: Context, member: PropertyMember, next: PropertyMember, at: At): ReadonlyArray<Change> => [
  ...optionalityChanges(member, next, at),
  ...mutabilityChanges(member, next, at),
  ...compareType(context, member.type, next.type, at),
]

const methodPairChanges = (context: Context, member: MethodMember, next: MethodMember, at: At): ReadonlyArray<Change> => [
  ...optionalityChanges(member, next, at),
  ...compareSignatureSets(context, member.signatures, next.signatures, at),
]

const isPropertyMember = (member: NamedMember): member is PropertyMember => member.kind === 'property'
const isMethodMember = (member: NamedMember): member is MethodMember => member.kind === 'method'

const propertyMemberChanges = (context: Context, member: PropertyMember, next: NamedMember, at: At): ReadonlyArray<Change> =>
  isPropertyMember(next) ? propertyPairChanges(context, member, next, at) : optionalityChanges(member, next, at)

const methodMemberChanges = (context: Context, member: MethodMember, next: NamedMember, at: At): ReadonlyArray<Change> =>
  isMethodMember(next) ? methodPairChanges(context, member, next, at) : optionalityChanges(member, next, at)

const sameKindMemberChanges = (context: Context, member: NamedMember, next: NamedMember, at: At): ReadonlyArray<Change> => {
  switch (member.kind) {
    case 'property':
      return propertyMemberChanges(context, member, next, at)
    case 'method':
      return methodMemberChanges(context, member, next, at)
  }
}

const matchedMemberChanges = (context: Context, member: NamedMember, next: NamedMember, at: At): ReadonlyArray<Change> => {
  const here = step(at, `member(${member.name})`)
  return memberKindChanged(member, next) ? [change('member-kind-changed', here)] : sameKindMemberChanges(context, member, next, here)
}

const memberChangesFor = (
  context: Context,
  member: NamedMember,
  next: NamedMember | undefined,
  at: At,
): ReadonlyArray<Change> => (next === undefined ? [] : matchedMemberChanges(context, member, next, at))

const memberChanges = (
  context: Context,
  afterNamed: ReadonlyMap<string, NamedMember>,
  member: NamedMember,
  at: At,
): ReadonlyArray<Change> => memberChangesFor(context, member, afterNamed.get(member.name), at)

const calledMembers = (members: ReadonlyArray<Member>): ReadonlyArray<Signature> =>
  members.flatMap((member) => (member.kind === 'call' ? [member.signature] : []))

const namedMembers = (members: ReadonlyArray<Member>): ReadonlyMap<string, NamedMember> =>
  new Map(members.flatMap((member) => (member.kind === 'call' ? [] : [[member.name, member] as const])))

const compareMembers = (
  context: Context,
  before: ReadonlyArray<Member>,
  after: ReadonlyArray<Member>,
  at: At,
): ReadonlyArray<Change> => {
  const beforeNamed = namedMembers(before)
  const afterNamed = namedMembers(after)
  const callChanges = compareSignatureSets(context, calledMembers(before), calledMembers(after), step(at, 'call'))
  const removed = [...beforeNamed.keys()]
    .filter((name) => !afterNamed.has(name))
    .map((name) => change('member-removed', step(at, `member(${name})`)))
  const added = [...afterNamed.values()]
    .filter((member) => !beforeNamed.has(member.name))
    .map((member) => change(member.optional ? 'optional-member-added' : 'required-member-added', step(at, `member(${member.name})`)))
  const changed = [...beforeNamed.values()].flatMap((member) => memberChanges(context, afterNamed, member, at))
  return [...callChanges, ...removed, ...added, ...changed]
}

const heritageKey = (types: ReadonlyArray<TypeExpr>): string => canonicalKey(types.map(typeKey).sort(Order.String))

const isFunctionItem = (item: ApiItem): item is FunctionItem => item.kind === 'function'
const isVariableItem = (item: ApiItem): item is VariableItem => item.kind === 'variable'
const isTypeAliasItem = (item: ApiItem): item is TypeAliasItem => item.kind === 'typeAlias'
const isCompositeItem = (item: ApiItem): item is InterfaceItem | ClassItem => item.kind === 'interface' || item.kind === 'class'
const isEnumItem = (item: ApiItem): item is EnumItem => item.kind === 'enum'
const isNamespaceItem = (item: ApiItem): item is NamespaceItem => item.kind === 'namespace'
const isClassItem = (item: InterfaceItem | ClassItem): item is ClassItem => item.kind === 'class'

const compareFunctionItem = (context: Context, before: FunctionItem, after: ApiItem, at: At): ReadonlyArray<Change> =>
  isFunctionItem(after) ? compareSignatureSets(context, before.signatures, after.signatures, { ...at, position: 'out' }) : []

const variablePosition = (item: VariableItem): Position => (item.constant ? 'out' : 'both')

const compareVariablePair = (context: Context, before: VariableItem, after: VariableItem, at: At): ReadonlyArray<Change> => {
  if (before.constant !== after.constant) return [change('variable-mutability-changed', { ...at, position: 'both' })]
  return compareType(context, before.type, after.type, { ...at, position: variablePosition(before) })
}

const compareVariableItem = (context: Context, before: VariableItem, after: ApiItem, at: At): ReadonlyArray<Change> =>
  isVariableItem(after) ? compareVariablePair(context, before, after, at) : []

const compareTypeAliasPair = (context: Context, before: TypeAliasItem, after: TypeAliasItem, at: At): ReadonlyArray<Change> => {
  const here: At = { ...at, position: 'both' }
  return [
    ...flagChange(typeParametersChanged(before, after), 'type-parameters-changed', here),
    ...compareType(context, before.type, after.type, here),
  ]
}

const compareTypeAliasItem = (context: Context, before: TypeAliasItem, after: ApiItem, at: At): ReadonlyArray<Change> =>
  isTypeAliasItem(after) ? compareTypeAliasPair(context, before, after, at) : []

const classHeritage = (item: ClassItem): string => canonicalKey([heritageKey(item.extends), heritageKey(item.implements)])

const interfaceHeritage = (item: InterfaceItem): string => heritageKey(item.extends)

const heritage = (item: InterfaceItem | ClassItem): string =>
  item.kind === 'class' ? classHeritage(item) : interfaceHeritage(item)

const abstractnessKind = (item: ClassItem): ChangeKind => (item.abstract ? 'class-became-abstract' : 'class-became-concrete')

const classAbstractnessPair = (before: ClassItem, after: ClassItem, at: At): ReadonlyArray<Change> =>
  before.abstract === after.abstract ? [] : [change(abstractnessKind(after), at)]

const classAbstractnessChanges = (before: ClassItem, after: InterfaceItem | ClassItem, at: At): ReadonlyArray<Change> =>
  isClassItem(after) ? classAbstractnessPair(before, after, at) : []

const abstractnessChanges = (before: InterfaceItem | ClassItem, after: InterfaceItem | ClassItem, at: At): ReadonlyArray<Change> =>
  isClassItem(before) ? classAbstractnessChanges(before, after, at) : []

const compareCompositePair = (
  context: Context,
  before: InterfaceItem | ClassItem,
  after: InterfaceItem | ClassItem,
  at: At,
): ReadonlyArray<Change> => {
  const here: At = { ...at, position: 'both' }
  return [
    ...abstractnessChanges(before, after, here),
    ...flagChange(typeParametersChanged(before, after), 'type-parameters-changed', here),
    ...flagChange(heritage(before) !== heritage(after), 'heritage-changed', here),
    ...compareMembers(context, before.members, after.members, here),
  ]
}

const compareCompositeItem = (
  context: Context,
  before: InterfaceItem | ClassItem,
  after: ApiItem,
  at: At,
): ReadonlyArray<Change> => (isCompositeItem(after) ? compareCompositePair(context, before, after, at) : [])

const enumMemberValueChanges = (
  member: EnumMember,
  values: ReadonlyMap<string, string | undefined>,
  at: At,
): ReadonlyArray<Change> =>
  values.get(member.name) === member.value ? [] : [change('enum-member-value-changed', step(at, `member(${member.name})`))]

const enumMemberChanges = (
  member: EnumMember,
  values: ReadonlyMap<string, string | undefined>,
  at: At,
): ReadonlyArray<Change> =>
  values.has(member.name) ? enumMemberValueChanges(member, values, at) : [change('enum-member-removed', step(at, `member(${member.name})`))]

const compareEnumPair = (before: EnumItem, after: EnumItem, at: At): ReadonlyArray<Change> => {
  const here: At = { ...at, position: 'both' }
  const values = new Map(after.members.map((member) => [member.name, member.value] as const))
  const names = new Set(before.members.map((member) => member.name))
  return [
    ...flagChange(before.const !== after.const, 'enum-const-changed', here),
    ...before.members.flatMap((member) => enumMemberChanges(member, values, here)),
    ...after.members
      .filter((member) => !names.has(member.name))
      .map((member) => change('enum-member-added', step(here, `member(${member.name})`))),
  ]
}

const compareEnumItem = (before: EnumItem, after: ApiItem, at: At): ReadonlyArray<Change> =>
  isEnumItem(after) ? compareEnumPair(before, after, at) : []

const compareNamespaceItem = (context: Context, before: NamespaceItem, after: ApiItem, at: At): ReadonlyArray<Change> =>
  isNamespaceItem(after) ? compareItems(context, before.items, after.items, `${at.location}.`) : []

const compareItem = (context: Context, before: ApiItem, after: ApiItem, at: At): ReadonlyArray<Change> => {
  switch (before.kind) {
    case 'function':
      return compareFunctionItem(context, before, after, at)
    case 'variable':
      return compareVariableItem(context, before, after, at)
    case 'typeAlias':
      return compareTypeAliasItem(context, before, after, at)
    case 'interface':
    case 'class':
      return compareCompositeItem(context, before, after, at)
    case 'enum':
      return compareEnumItem(before, after, at)
    case 'namespace':
      return compareNamespaceItem(context, before, after, at)
  }
}

const compareItems = (
  context: Context,
  before: ReadonlyArray<ApiItem>,
  after: ReadonlyArray<ApiItem>,
  prefix: string,
): ReadonlyArray<Change> => {
  const names = new Set([...before, ...after].map((item) => item.name))
  return [...names].flatMap((name) =>
    compareNamed(
      context,
      before.filter((item) => item.name === name),
      after.filter((item) => item.name === name),
      { position: 'out', location: `${prefix}${name}` },
    ),
  )
}

const unmatched = (from: ReadonlyArray<ApiItem>, to: ReadonlyArray<ApiItem>): ReadonlyArray<ApiItem> => {
  const [fromKeys, toKeys] = [from.map(canonicalKey), to.map(canonicalKey)]
  return from.filter((_, index) => {
    const key = fromKeys[index]
    return fromKeys.slice(0, index).filter((other) => other === key).length >= toKeys.filter((other) => other === key).length
  })
}

const inCanonicalOrder = (items: ReadonlyArray<ApiItem>): ReadonlyArray<ApiItem> =>
  [...items].sort((left, right) => Order.String(canonicalKey(left), canonicalKey(right)))

const compareNamed = (
  context: Context,
  before: ReadonlyArray<ApiItem>,
  after: ReadonlyArray<ApiItem>,
  at: At,
): ReadonlyArray<Change> => {
  const kinds = new Set([...before, ...after].map((item) => item.kind))
  const groups = [...kinds].map((kind) => {
    const [from, to] = [before.filter((item) => item.kind === kind), after.filter((item) => item.kind === kind)]
    return { from: inCanonicalOrder(unmatched(from, to)), to: inCanonicalOrder(unmatched(to, from)) }
  })
  const paired = groups.flatMap(({ from, to }) =>
    Arr.zip(from.slice(0, to.length), to).flatMap(([item, other]) => compareItem(context, item, other, at)),
  )
  const removed = groups.flatMap(({ from, to }) => from.slice(to.length))
  const added = groups.flatMap(({ from, to }) => to.slice(from.length))
  return [
    ...paired,
    ...removed.slice(0, added.length).map(() => change('export-kind-changed', at)),
    ...removed.slice(added.length).map(() => change('export-removed', at)),
    ...added.slice(removed.length).map(() => change('export-added', at)),
  ]
}

const expandedItems = (entryPoint: EntryPoint): ReadonlyArray<ApiItem> => {
  const scope: Scope = {
    aliases: new Map(
      [...entryPoint.locals, ...entryPoint.items.filter((item): item is TypeAliasItem => item.kind === 'typeAlias')].map(
        (alias) => [alias.name, alias] as const,
      ),
    ),
    bindings: new Map(),
    expanding: new Set(),
  }
  return entryPoint.items.map((item) => expandItem(item, scope))
}

/**
 * Every difference between two models of the same package. Locations read
 * `<entry point>:<export>/<path>`, e.g. `.:getUser/signature[0]/returns/E`.
 */
export const diffModels: {
  (after: ApiModel, channelTypes: ReadonlyArray<ChannelType>): (before: ApiModel) => Changes
  (before: ApiModel, after: ApiModel, channelTypes: ReadonlyArray<ChannelType>): Changes
} = Function.dual(3, (before: ApiModel, after: ApiModel, channelTypes: ReadonlyArray<ChannelType>): Changes => {
  const context: Context = { channelTypes }
  const afterByPath = new Map(after.entryPoints.map((entryPoint) => [entryPoint.path, entryPoint] as const))
  const beforePaths = new Set(before.entryPoints.map((entryPoint) => entryPoint.path))
  return [
    ...before.entryPoints.flatMap((entryPoint) => {
      const next = afterByPath.get(entryPoint.path)
      return next === undefined
        ? [change('entry-point-removed', { position: 'out', location: entryPoint.path })]
        : compareItems(context, expandedItems(entryPoint), expandedItems(next), `${entryPoint.path}:`)
    }),
    ...after.entryPoints
      .filter((entryPoint) => !beforePaths.has(entryPoint.path))
      .map((entryPoint) => change('entry-point-added', { position: 'out', location: entryPoint.path })),
  ]
})
