import { Function, Order, Schema } from 'effect'
import { canonicalKey } from '../canonical-json.schema.ts'
import type { ApiItem, ApiModel, EntryPoint, TypeAliasItem } from '../model/api-model.schema.ts'
import { type Member, normaliseType, type Parameter, type Signature, type TypeExpr, type TypeParameter, typeKey } from '../model/type-expr.schema.ts'
import { type Direction, direction } from './direction.schema.ts'
import { type ChannelType, compose, flip, type Position } from './position.schema.ts'

export const ChangeKind = Schema.Literals([
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
])
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

/** Every difference between two models. */
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

const change = (kind: ChangeKind, at: At, extra: Partial<Change> = {}): Change => ({
  kind,
  location: at.location,
  position: at.position,
  ...(at.channel === undefined ? {} : { channel: at.channel }),
  ...extra,
})

const step = (at: At, segment: string, position: Position = at.position): At => ({
  ...at,
  position,
  location: `${at.location}/${segment}`,
})

/**
 * Same-package type aliases in scope, and the ones being expanded on this
 * path (a cycle stops expansion), and the type parameters that shadow them.
 */
interface Scope {
  readonly aliases: Aliases
  readonly bindings: ReadonlyMap<string, TypeExpr>
  readonly expanding: ReadonlySet<string>
}

const without = <V>(map: ReadonlyMap<string, V>, names: ReadonlyArray<string>): ReadonlyMap<string, V> =>
  names.some((name) => map.has(name)) ? new Map([...map].filter(([key]) => !names.includes(key))) : map

/**
 * Replaces every reference to a same-package type alias with the alias body,
 * so a change to an alias shows where it is used and equal keys mean equal surfaces.
 */
const expandType = (type: TypeExpr, scope: Scope): TypeExpr => {
  switch (type.kind) {
    case 'reference': {
      if (type.module === undefined && type.args.length === 0) {
        const bound = scope.bindings.get(type.name)
        if (bound !== undefined) return bound
      }
      const args = type.args.map((arg) => expandType(arg, scope))
      const alias = type.module === undefined ? scope.aliases.get(type.name) : undefined
      if (alias === undefined || scope.expanding.has(type.name)) return { ...type, args }
      const expanding = new Set([...scope.expanding, type.name])
      // A default may name an alias or an earlier parameter, so it is expanded where it is declared.
      const bindings = alias.typeParameters.reduce<ReadonlyMap<string, TypeExpr>>(
        (bound, parameter, index) =>
          new Map([
            ...bound,
            [
              parameter.name,
              args[index] ??
                (parameter.default === undefined
                  ? { kind: 'keyword', name: 'unknown' }
                  : expandType(parameter.default, { aliases: scope.aliases, bindings: bound, expanding })),
            ],
          ]),
        new Map(),
      )
      return expandType(alias.type, { aliases: scope.aliases, bindings, expanding })
    }
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

/** Constraints and defaults, in the scope the parameters themselves open. */
const expandTypeParameters = (parameters: ReadonlyArray<TypeParameter>, scope: Scope): ReadonlyArray<TypeParameter> =>
  parameters.map((parameter) => ({
    name: parameter.name,
    ...(parameter.constraint === undefined ? {} : { constraint: expandType(parameter.constraint, scope) }),
    ...(parameter.default === undefined ? {} : { default: expandType(parameter.default, scope) }),
  }))

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

type Reference = TypeExpr & { readonly kind: 'reference' }

/** The channel type a reference spells, given every channel it leaves out has a default. */
const channelTypeOf = (context: Context, type: Reference): ChannelType | undefined =>
  context.channelTypes.find(
    (candidate) =>
      candidate.names.includes(type.name) &&
      (type.module === undefined || candidate.modules.includes(type.module)) &&
      type.args.length <= candidate.channels.length &&
      candidate.channels.slice(type.args.length).every((slot) => slot.default !== undefined),
  )

/** Every channel's argument, the left-out ones filled with their defaults. */
const channelArgs = (channelType: ChannelType, type: Reference): ReadonlyArray<TypeExpr> =>
  channelType.channels.map((slot, index) => type.args[index] ?? (slot.default as TypeExpr))

const compareType = (context: Context, before: TypeExpr, after: TypeExpr, at: At): ReadonlyArray<Change> => {
  const b = normaliseType(before)
  const a = normaliseType(after)
  // Both sides are normalised, so their canonical keys are their structural identity.
  if (canonicalKey(b) === canonicalKey(a)) return []

  if (b.kind === 'reference' && a.kind === 'reference' && b.name === a.name && b.module === a.module) {
    const channelType = channelTypeOf(context, b)
    if (channelType !== undefined && channelTypeOf(context, a) === channelType) {
      const [from, to] = [channelArgs(channelType, b), channelArgs(channelType, a)]
      return channelType.channels.flatMap((slot, index) =>
        compareType(context, from[index] as TypeExpr, to[index] as TypeExpr, {
          position: compose(at.position, slot.variance),
          location: `${at.location}/${slot.name}`,
          channel: slot.name,
        }),
      )
    }
  }
  if (b.kind === 'reference' && a.kind === 'reference' && b.name === a.name && b.module === a.module && b.args.length === a.args.length) {
    return b.args.flatMap((arg, index) => compareType(context, arg, a.args[index] as TypeExpr, step(at, `arg[${index}]`, 'both')))
  }
  if (b.kind === 'function' && a.kind === 'function') {
    return compareSignature(context, b.signature, a.signature, at)
  }
  if (b.kind === 'object' && a.kind === 'object') {
    return compareMembers(context, b.members, a.members, at)
  }
  if (b.kind === 'array' && a.kind === 'array' && b.readonly === a.readonly) {
    return compareType(context, b.element, a.element, step(at, 'element'))
  }
  if (b.kind === 'tuple' && a.kind === 'tuple' && b.readonly === a.readonly && b.elements.length === a.elements.length) {
    return b.elements.flatMap((element, index) => compareType(context, element, a.elements[index] as TypeExpr, step(at, `element[${index}]`)))
  }
  const moved = direction(b, a)
  return moved === undefined ? [] : [change('type-changed', at, { direction: moved })]
}

const typeParametersKey = (parameters: ReadonlyArray<TypeParameter>): string =>
  canonicalKey(
    parameters.map((parameter) => ({
      name: parameter.name,
      constraint: parameter.constraint === undefined ? null : typeKey(parameter.constraint),
      default: parameter.default === undefined ? null : typeKey(parameter.default),
    })),
  )

const compareParameter = (
  context: Context,
  before: Parameter,
  after: Parameter,
  at: At,
): ReadonlyArray<Change> => {
  const flags: ReadonlyArray<Change> = [
    ...(before.optional && !after.optional ? [change('parameter-became-required', at)] : []),
    ...(!before.optional && after.optional ? [change('parameter-became-optional', at)] : []),
    ...(before.rest === after.rest ? [] : [change('parameter-rest-changed', at)]),
  ]
  return [...flags, ...compareType(context, before.type, after.type, { ...at, position: flip(at.position) })]
}

const compareSignature = (
  context: Context,
  before: Signature,
  after: Signature,
  at: At,
): ReadonlyArray<Change> => {
  const typeParameters =
    typeParametersKey(before.typeParameters) === typeParametersKey(after.typeParameters)
      ? []
      : [change('type-parameters-changed', at)]
  const shared = Math.min(before.parameters.length, after.parameters.length)
  const parameters = before.parameters.slice(0, shared).flatMap((parameter, index) =>
    compareParameter(context, parameter, after.parameters[index] as Parameter, step(at, `parameter[${index}]`)),
  )
  const added = after.parameters.slice(shared).map((parameter, offset) =>
    change(
      parameter.optional || parameter.rest ? 'optional-parameter-added' : 'required-parameter-added',
      step(at, `parameter[${shared + offset}]`),
    ),
  )
  const removed = before.parameters.slice(shared).map((_, offset) => change('parameter-removed', step(at, `parameter[${shared + offset}]`)))
  const returns = compareType(context, before.returns, after.returns, step(at, 'returns'))
  return [...typeParameters, ...parameters, ...added, ...removed, ...returns]
}

type Form = 'data-first' | 'data-last' | 'plain'

/**
 * Classifies each signature of an overload set: a `data-last` signature
 * returns a one-parameter function, and its `data-first` partner takes that
 * parameter first followed by the same arguments. This is Effect's dual API.
 */
const formsOf = (signatures: ReadonlyArray<Signature>): ReadonlyArray<Form> => {
  const isDataLast = (signature: Signature): boolean =>
    signature.returns.kind === 'function' && signature.returns.signature.parameters.length === 1
  const partners = (dataFirst: Signature, dataLast: Signature): boolean => {
    if (dataLast.returns.kind !== 'function' || dataFirst.parameters.length !== dataLast.parameters.length + 1) return false
    const self = dataLast.returns.signature.parameters[0] as Parameter
    return typeKey((dataFirst.parameters[0] as Parameter).type) === typeKey(self.type)
  }
  return signatures.map((signature) => {
    if (isDataLast(signature) && signatures.some((other) => other !== signature && partners(other, signature))) return 'data-last'
    if (signatures.some((other) => other !== signature && isDataLast(other) && partners(signature, other))) return 'data-first'
    return 'plain'
  })
}

const signatureKey = (signature: Signature): string => canonicalKey(signature)

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
  const unmatched = (signatures: ReadonlyArray<Signature>, keys: ReadonlyArray<string>, forms: ReadonlyArray<Form>, others: ReadonlySet<string>) =>
    signatures
      .map((signature, index) => ({ signature, index, form: forms[index] as Form }))
      .filter((entry) => !others.has(keys[entry.index] as string))
  const left = unmatched(before, beforeKeys, beforeForms, new Set(afterKeys))
  const right = unmatched(after, afterKeys, afterForms, new Set(beforeKeys))
  const forms: ReadonlyArray<Form> = ['data-first', 'data-last', 'plain']
  return forms.flatMap((form) => {
    const l = left.filter((entry) => entry.form === form)
    const r = right.filter((entry) => entry.form === form)
    const paired = l.slice(0, r.length).flatMap((entry, index) =>
      compareSignature(context, entry.signature, (r[index] as (typeof r)[number]).signature, step(at, `signature[${entry.index}]`)),
    )
    const dual = form !== 'plain'
    const removed = l.slice(r.length).map((entry) =>
      change(dual && !afterForms.includes(form) ? 'dual-form-removed' : 'overload-removed', step(at, `signature[${entry.index}]`)),
    )
    const added = r.slice(l.length).map((entry) =>
      change(dual && !beforeForms.includes(form) ? 'dual-form-added' : 'overload-added', step(at, `signature[${entry.index}]`)),
    )
    return [...paired, ...removed, ...added]
  })
}

const compareMembers = (
  context: Context,
  before: ReadonlyArray<Member>,
  after: ReadonlyArray<Member>,
  at: At,
): ReadonlyArray<Change> => {
  const calls = (members: ReadonlyArray<Member>): ReadonlyArray<Signature> =>
    members.flatMap((member) => (member.kind === 'call' ? [member.signature] : []))
  const named = (members: ReadonlyArray<Member>) =>
    new Map(members.flatMap((member) => (member.kind === 'call' ? [] : [[member.name, member] as const])))
  const beforeNamed = named(before)
  const afterNamed = named(after)
  const callChanges = compareSignatureSets(context, calls(before), calls(after), step(at, 'call'))
  const removed = [...beforeNamed.keys()]
    .filter((name) => !afterNamed.has(name))
    .map((name) => change('member-removed', step(at, `member(${name})`)))
  const added = [...afterNamed.values()]
    .filter((member) => !beforeNamed.has(member.name))
    .map((member) => change(member.optional ? 'optional-member-added' : 'required-member-added', step(at, `member(${member.name})`)))
  const changed = [...beforeNamed.values()].flatMap((member) => {
    const next = afterNamed.get(member.name)
    if (next === undefined) return []
    const here = step(at, `member(${member.name})`)
    if (member.kind !== next.kind) return [change('member-kind-changed', here)]
    const optionality: ReadonlyArray<Change> = [
      ...(member.optional && !next.optional ? [change('member-became-required', here)] : []),
      ...(!member.optional && next.optional ? [change('member-became-optional', here)] : []),
    ]
    if (member.kind === 'property' && next.kind === 'property') {
      const mutability: ReadonlyArray<Change> = [
        ...(!member.readonly && next.readonly ? [change('member-became-readonly', here)] : []),
        ...(member.readonly && !next.readonly ? [change('member-became-mutable', here)] : []),
      ]
      return [...optionality, ...mutability, ...compareType(context, member.type, next.type, here)]
    }
    if (member.kind === 'method' && next.kind === 'method') {
      return [...optionality, ...compareSignatureSets(context, member.signatures, next.signatures, here)]
    }
    return optionality
  })
  return [...callChanges, ...removed, ...added, ...changed]
}

const heritageKey = (types: ReadonlyArray<TypeExpr>): string => canonicalKey([...types.map(typeKey)].sort(Order.String))

const compareItem = (context: Context, before: ApiItem, after: ApiItem, at: At): ReadonlyArray<Change> => {
  switch (before.kind) {
    case 'function':
      return compareSignatureSets(context, before.signatures, (after as typeof before).signatures, { ...at, position: 'out' })
    case 'variable': {
      const next = after as typeof before
      if (before.constant !== next.constant) return [change('variable-mutability-changed', { ...at, position: 'both' })]
      return compareType(context, before.type, next.type, { ...at, position: before.constant ? 'out' : 'both' })
    }
    case 'typeAlias': {
      const next = after as typeof before
      const here: At = { ...at, position: 'both' }
      return [
        ...(typeParametersKey(before.typeParameters) === typeParametersKey(next.typeParameters) ? [] : [change('type-parameters-changed', here)]),
        ...compareType(context, before.type, next.type, here),
      ]
    }
    case 'interface':
    case 'class': {
      const next = after as typeof before
      const here: At = { ...at, position: 'both' }
      const heritage = (item: ApiItem): string =>
        item.kind === 'class'
          ? canonicalKey([heritageKey(item.extends), heritageKey(item.implements)])
          : item.kind === 'interface'
            ? heritageKey(item.extends)
            : ''
      const abstract: ReadonlyArray<Change> =
        before.kind === 'class' && next.kind === 'class' && before.abstract !== next.abstract
          ? [change(next.abstract ? 'class-became-abstract' : 'class-became-concrete', here)]
          : []
      return [
        ...abstract,
        ...(typeParametersKey(before.typeParameters) === typeParametersKey(next.typeParameters) ? [] : [change('type-parameters-changed', here)]),
        ...(heritage(before) === heritage(next) ? [] : [change('heritage-changed', here)]),
        ...compareMembers(context, before.members, next.members, here),
      ]
    }
    case 'enum': {
      const next = after as typeof before
      const here: At = { ...at, position: 'both' }
      const values = new Map(next.members.map((member) => [member.name, member.value] as const))
      const names = new Set(before.members.map((member) => member.name))
      return [
        ...(before.const === next.const ? [] : [change('enum-const-changed', here)]),
        ...before.members.flatMap((member) =>
          !values.has(member.name)
            ? [change('enum-member-removed', step(here, `member(${member.name})`))]
            : values.get(member.name) === member.value
              ? []
              : [change('enum-member-value-changed', step(here, `member(${member.name})`))],
        ),
        ...next.members
          .filter((member) => !names.has(member.name))
          .map((member) => change('enum-member-added', step(here, `member(${member.name})`))),
      ]
    }
    case 'namespace':
      return compareItems(context, before.items, (after as typeof before).items, `${at.location}.`)
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

const compareNamed = (context: Context, before: ReadonlyArray<ApiItem>, after: ReadonlyArray<ApiItem>, at: At): ReadonlyArray<Change> => {
  const kinds = new Set([...before, ...after].map((item) => item.kind))
  const groups = [...kinds].map((kind) => {
    const [from, to] = [before.filter((item) => item.kind === kind), after.filter((item) => item.kind === kind)]
    return { from: inCanonicalOrder(unmatched(from, to)), to: inCanonicalOrder(unmatched(to, from)) }
  })
  const paired = groups.flatMap(({ from, to }) => from.slice(0, to.length).flatMap((item, index) => compareItem(context, item, to[index] as ApiItem, at)))
  const removed = groups.flatMap(({ from, to }) => from.slice(to.length))
  const added = groups.flatMap(({ from, to }) => to.slice(from.length))
  return [
    ...paired,
    ...removed.slice(0, added.length).map(() => change('export-kind-changed', at)),
    ...removed.slice(added.length).map(() => change('export-removed', at)),
    ...added.slice(removed.length).map(() => change('export-added', at)),
  ]
}

/** The entry point's exports with every same-package alias reference expanded. */
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
