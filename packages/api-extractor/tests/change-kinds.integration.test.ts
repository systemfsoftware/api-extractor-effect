import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ApiModel, Verdict } from '@systemfsoftware/api-extractor'
import { Effect, Layer, Result } from 'effect'
import {
  decodeVerdict,
  effect,
  empty,
  fn,
  functionItem,
  never,
  parameter,
  ref,
  signature,
  TARGET,
  union,
  voidType,
  withEntryPoints,
  withExport,
} from './__fixtures__/surfaces.ts'

type Model = ApiModel.ApiModel
type Item = ApiModel.ApiItem
type Member = ApiModel.Member
type Parameter = ApiModel.Parameter
type Signature = ApiModel.Signature
type TypeExpr = ApiModel.TypeExpr
type Bump = Extract<Verdict.Bump, 'major' | 'minor'>

const Feature = makeFeature({ it })

const classItem = (overrides: Partial<ApiModel.ClassItem> = {}): Item => ({
  kind: 'class',
  name: TARGET,
  abstract: false,
  typeParameters: [],
  extends: [],
  implements: [],
  members: [],
  ...overrides,
})
const property = (name: string, type: TypeExpr, { optional = false, readonly = false } = {}): Member => ({
  kind: 'property',
  name,
  optional,
  readonly,
  type,
})
const method = (name: string, returns: TypeExpr): Member => ({ kind: 'method', name, optional: false, signatures: [signature([], returns)] })
const object = (...members: ReadonlyArray<Member>): TypeExpr => ({ kind: 'object', members })
const enumItem = (...members: ReadonlyArray<string>): Item => ({ kind: 'enum', name: TARGET, const: false, members: members.map((name) => ({ name })) })
const valuedEnum = (value: string, isConst = false): Item => ({ kind: 'enum', name: TARGET, const: isConst, members: [{ name: 'A', value }] })
const variable = (constant: boolean, type: TypeExpr): Item => ({ kind: 'variable', name: TARGET, constant, type })
const returning = (type: TypeExpr) => functionItem(signature([], type))
const taking = (type: TypeExpr) => functionItem(signature([parameter('self', type)], voidType))
const callback = (...parameters: ReadonlyArray<Parameter>) => taking(fn(signature(parameters, voidType)))
const layer = (requirements: TypeExpr) => returning(ref('Layer', ref('S'), never, requirements))
const restParameter: Parameter = { name: 'rest', type: ref('Arr'), optional: false, rest: true }
const either = union([ref('A'), ref('B')])
const channels = {
  A: (slot: TypeExpr) => effect(slot, ref('Failure')),
  E: (slot: TypeExpr) => effect(ref('Value'), slot),
  R: (slot: TypeExpr) => effect(ref('Value'), ref('Failure'), slot),
}
const channelRow = (
  channel: keyof typeof channels,
  position: 'out' | 'in',
  moved: 'widened' | 'narrowed',
  bump: Bump,
  reason: string,
): Row => {
  const [from, to] = moved === 'widened' ? [ref('A'), either] : [either, ref('A')]
  const surface = (slot: TypeExpr) => (position === 'out' ? returning : taking)(channels[channel](slot))
  return [`an Effect ${channel} channel ${moved} in ${position === 'out' ? 'a return' : 'a parameter'}`, surface(from), surface(to), bump, reason]
}
const dualForms: readonly [Signature, Signature] = (() => {
  const mapper = parameter('f', fn(signature([parameter('a', ref('A'))], ref('B'))))
  const self = parameter('self', effect(ref('A'), ref('Failure')))
  return [signature([mapper], fn(signature([self], effect(ref('B'), ref('Failure'))))), signature([self, mapper], effect(ref('B'), ref('Failure')))]
})()
const dual = (...forms: ReadonlyArray<Signature>): Item => variable(true, object(...forms.map((sig): Member => ({ kind: 'call', signature: sig }))))
const servicesLayer = (services: TypeExpr) => returning(ref('Layer', services, never, never))
const withEntryPoint: Model = withEntryPoints(empty, [...empty.entryPoints, { path: './extra', items: [], locals: [] }])

type Row = readonly [string, Item | Model, Item | Model, Bump, string]
const rows: ReadonlyArray<Row> = [
  ['an entry point is removed', withEntryPoint, empty, 'major', 'ENTRY_POINT_REMOVED'],
  ['an entry point is added', empty, withEntryPoint, 'minor', 'ENTRY_POINT_ADDED'],
  ['an export is removed', withExport(empty, returning(ref('A'))), empty, 'major', 'EXPORT_REMOVED'],
  ['an export is added', empty, withExport(empty, returning(ref('A'))), 'minor', 'EXPORT_ADDED'],
  ['a function export becomes a variable', returning(ref('A')), variable(true, ref('A')), 'major', 'EXPORT_KIND_CHANGED'],
  ['a dual loses its data-last form', dual(...dualForms), dual(dualForms[1]), 'major', 'DUAL_FORM_REMOVED'],
  ['a data-first function gains its data-last form', dual(dualForms[1]), dual(...dualForms), 'minor', 'DUAL_FORM_ADDED'],
  ['a function gains a required parameter', returning(voidType), functionItem(signature([parameter('x', ref('X'))], voidType)), 'major', 'REQUIRED_PARAMETER_ADDED'],
  ['a function gains an optional parameter', returning(voidType), functionItem(signature([parameter('x', ref('X'), true)], voidType)), 'minor', 'OPTIONAL_PARAMETER_ADDED'],
  ['a returned layer provides one service fewer', servicesLayer(either), servicesLayer(ref('A')), 'major', 'LAYER_SERVICE_REMOVED'],
  ['a returned layer provides another service', servicesLayer(ref('A')), servicesLayer(either), 'minor', 'LAYER_SERVICE_ADDED'],
  ['an overload is dropped', functionItem(signature([], ref('A')), signature([parameter('x', ref('X'))], ref('A'))), functionItem(signature([], ref('A'))), 'major', 'OVERLOAD_REMOVED'],
  ['an overload is added', functionItem(signature([], ref('A'))), functionItem(signature([], ref('A')), signature([parameter('x', ref('X'))], ref('A'))), 'minor', 'OVERLOAD_ADDED'],
  ['a parameter is removed', functionItem(signature([parameter('x', ref('X'))], voidType)), functionItem(signature([], voidType)), 'major', 'PARAMETER_REMOVED'],
  ['a parameter becomes optional', functionItem(signature([parameter('x', ref('X'))], voidType)), functionItem(signature([parameter('x', ref('X'), true)], voidType)), 'minor', 'PARAMETER_BECAME_OPTIONAL'],
  ['a parameter becomes required', functionItem(signature([parameter('x', ref('X'), true)], voidType)), functionItem(signature([parameter('x', ref('X'))], voidType)), 'major', 'PARAMETER_BECAME_REQUIRED'],
  ['a parameter becomes a rest parameter', functionItem(signature([parameter('rest', ref('Arr'))], voidType)), functionItem(signature([restParameter], voidType)), 'major', 'PARAMETER_REST_CHANGED'],
  ['a callback is handed a new parameter', callback(), callback(parameter('x', ref('X'))), 'minor', 'CALLBACK_PARAMETER_ADDED'],
  ['a callback parameter becomes optional', callback(parameter('x', ref('X'))), callback(parameter('x', ref('X'), true)), 'major', 'CALLBACK_PARAMETER_BECAME_OPTIONAL'],
  ['a callback parameter becomes required', callback(parameter('x', ref('X'), true)), callback(parameter('x', ref('X'))), 'minor', 'CALLBACK_PARAMETER_BECAME_REQUIRED'],
  ['a member is removed', classItem({ members: [property('p', ref('P'))] }), classItem(), 'major', 'MEMBER_REMOVED'],
  ['a property becomes a method', classItem({ members: [property('p', ref('P'))] }), classItem({ members: [method('p', ref('P'))] }), 'major', 'MEMBER_KIND_CHANGED'],
  ['a class gains a required member', classItem(), classItem({ members: [property('p', ref('P'))] }), 'major', 'REQUIRED_MEMBER_ADDED'],
  ['a returned object gains a member', returning(object()), returning(object(property('p', ref('P')))), 'minor', 'MEMBER_ADDED_TO_OUTPUT'],
  ['a class gains an optional member', classItem(), classItem({ members: [property('p', ref('P'), { optional: true })] }), 'minor', 'OPTIONAL_MEMBER_ADDED'],
  ['a class member becomes optional', classItem({ members: [property('p', ref('P'))] }), classItem({ members: [property('p', ref('P'), { optional: true })] }), 'major', 'MEMBER_BECAME_OPTIONAL'],
  ['a member of an accepted object becomes optional', taking(object(property('p', ref('P')))), taking(object(property('p', ref('P'), { optional: true }))), 'minor', 'INPUT_MEMBER_BECAME_OPTIONAL'],
  ['a class member becomes required', classItem({ members: [property('p', ref('P'), { optional: true })] }), classItem({ members: [property('p', ref('P'))] }), 'major', 'MEMBER_BECAME_REQUIRED'],
  ['a member of a returned object becomes required', returning(object(property('p', ref('P'), { optional: true }))), returning(object(property('p', ref('P')))), 'minor', 'OUTPUT_MEMBER_BECAME_REQUIRED'],
  ['a property becomes readonly', classItem({ members: [property('p', ref('P'))] }), classItem({ members: [property('p', ref('P'), { readonly: true })] }), 'major', 'MEMBER_BECAME_READONLY'],
  ['a readonly property becomes mutable', classItem({ members: [property('p', ref('P'), { readonly: true })] }), classItem({ members: [property('p', ref('P'))] }), 'minor', 'MEMBER_BECAME_MUTABLE'],
  ['a const becomes a let', variable(true, ref('A')), variable(false, ref('A')), 'major', 'VARIABLE_MUTABILITY_CHANGED'],
  ['a class becomes abstract', classItem(), classItem({ abstract: true }), 'major', 'CLASS_BECAME_ABSTRACT'],
  ['a class becomes concrete', classItem({ abstract: true }), classItem(), 'minor', 'CLASS_BECAME_CONCRETE'],
  ['a base class becomes an implemented interface', classItem({ extends: [ref('Base')] }), classItem({ implements: [ref('Base')] }), 'major', 'HERITAGE_CHANGED'],
  ['an implemented interface is dropped', classItem({ implements: [ref('Iface')] }), classItem(), 'major', 'HERITAGE_CHANGED'],
  ['a type parameter is added', classItem(), classItem({ typeParameters: [{ name: 'T' }] }), 'major', 'TYPE_PARAMETERS_CHANGED'],
  ['an enum member is removed', enumItem('A', 'B'), enumItem('A'), 'major', 'ENUM_MEMBER_REMOVED'],
  ['an enum member is added', enumItem('A'), enumItem('A', 'B'), 'minor', 'ENUM_MEMBER_ADDED'],
  ['an enum member value changes', valuedEnum('1'), valuedEnum('2'), 'major', 'ENUM_MEMBER_VALUE_CHANGED'],
  ['an enum becomes a const enum', valuedEnum('1'), valuedEnum('1', true), 'major', 'ENUM_CONST_CHANGED'],
  ['a return type is replaced by an unrelated one', returning(ref('A')), returning(ref('B')), 'major', 'TYPE_CHANGED'],
  ['a return type widens', returning(ref('A')), returning(either), 'major', 'TYPE_WIDENED_IN_OUTPUT'],
  ['a return type narrows', returning(either), returning(ref('A')), 'minor', 'TYPE_NARROWED_IN_OUTPUT'],
  ['a parameter type widens', taking(ref('A')), taking(either), 'minor', 'TYPE_WIDENED_IN_INPUT'],
  ['a parameter type narrows', taking(either), taking(ref('A')), 'major', 'TYPE_NARROWED_IN_INPUT'],
  ['a mutable variable type widens', variable(false, ref('A')), variable(false, either), 'major', 'TYPE_WIDENED_IN_SHARED_POSITION'],
  ['a mutable variable type narrows', variable(false, either), variable(false, ref('A')), 'major', 'TYPE_NARROWED_IN_SHARED_POSITION'],
  ['a returned layer requires another service', layer(ref('A')), layer(either), 'major', 'LAYER_REQUIREMENT_ADDED'],
  ['a returned layer requires one service fewer', layer(either), layer(ref('A')), 'minor', 'LAYER_REQUIREMENT_REMOVED'],
  channelRow('A', 'out', 'widened', 'major', 'A_WIDENED'),
  channelRow('A', 'out', 'narrowed', 'minor', 'A_NARROWED'),
  channelRow('A', 'in', 'widened', 'minor', 'A_WIDENED_IN_INPUT'),
  channelRow('A', 'in', 'narrowed', 'major', 'A_NARROWED_IN_INPUT'),
  channelRow('E', 'out', 'widened', 'major', 'E_WIDENED'),
  channelRow('E', 'out', 'narrowed', 'major', 'E_TAG_REMOVED'),
  channelRow('E', 'in', 'widened', 'minor', 'E_WIDENED_IN_INPUT'),
  channelRow('E', 'in', 'narrowed', 'major', 'E_NARROWED_IN_INPUT'),
  channelRow('R', 'out', 'widened', 'major', 'R_WIDENED'),
  channelRow('R', 'out', 'narrowed', 'minor', 'R_NARROWED'),
  channelRow('R', 'in', 'widened', 'minor', 'R_WIDENED_IN_INPUT'),
  channelRow('R', 'in', 'narrowed', 'major', 'R_NARROWED_IN_INPUT'),
]

type Case = { readonly label: string; readonly before: Model; readonly after: Model; readonly bump: Bump; readonly reason: string }
const cases: ReadonlyArray<Case> = rows.map(([label, before, after, bump, reason]) => ({
  label,
  before: 'entryPoints' in before ? before : withExport(empty, before),
  after: 'entryPoints' in after ? after : withExport(empty, after),
  bump,
  reason,
}))

Feature('The verdict judges every change kind the diff emits')
  .withLayer(Layer.empty)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'the verdict for <label> is <bump> <reason>',
      cases,
      (row) =>
        Gherkin.Do.pipe(
          Given('the two surfaces of the fixture package')('row', () => Effect.sync(() => row)),
          When('the verdict cell judges them against the shipped corpus')('verdict', (scope) =>
            Effect.map(Verdict.cell.run({ before: scope.row.before, after: scope.row.after }), decodeVerdict),
          ),
          Then('the verdict reports the expected bump and reason')((scope, expect) =>
            expect(Result.map(scope.verdict, (verdict) => [verdict.bump, verdict.findings.map((finding) => finding.reason_code)])).toEqual(
              Result.succeed([scope.row.bump, [scope.row.reason]]),
            ),
          ),
        ),
    )
  })
