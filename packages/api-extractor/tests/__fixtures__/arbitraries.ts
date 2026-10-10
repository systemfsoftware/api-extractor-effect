import fc from 'fast-check'
import { API_MODEL_SCHEMA_VERSION, type ApiItem, type ApiModel, type EntryPoint, type TypeAliasItem } from '../../src/model/api-model.ts'
import { KeywordName, type Member, type Parameter, type Signature, type TypeExpr, type TypeParameter } from '../../src/model/type-expr.ts'

/** Characters whose case mapping or collation differs across locales (Turkish i, German sharp s). */
const unit = fc.constantFrom('a', 'b', 'i', 'I', 'ı', 'İ', 'ß', 'Z', 'é', '_', '$', 'ä', 'Ä')

/** Identifiers drawn from locale-sensitive characters. */
export const name: fc.Arbitrary<string> = fc.string({ unit, minLength: 1, maxLength: 5 })

const keyword = fc.constantFrom<KeywordName>(...KeywordName.literals)

const literal = fc.oneof(
  fc.string({ unit, maxLength: 4 }).map((text) => JSON.stringify(text)),
  fc.integer({ min: -9, max: 99 }).map(String),
  fc.constantFrom('true', 'false'),
)

const { typeExpr, member, typeParameters } = fc.letrec<{
  typeExpr: TypeExpr
  signature: Signature
  member: Member
  typeParameters: ReadonlyArray<TypeParameter>
}>((tie) => ({
  typeExpr: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    keyword.map((value): TypeExpr => ({ kind: 'keyword', name: value })),
    literal.map((text): TypeExpr => ({ kind: 'literal', text })),
    fc
      .record({ name, args: fc.array(tie('typeExpr'), { maxLength: 3 }), module: fc.option(fc.constantFrom('effect', 'other-pkg'), { nil: undefined }) })
      .map(({ name: reference, args, module }): TypeExpr => ({ kind: 'reference', name: reference, args, ...(module === undefined ? {} : { module }) })),
    fc.array(tie('typeExpr'), { minLength: 2, maxLength: 3 }).map((members): TypeExpr => ({ kind: 'union', members })),
    fc.array(tie('typeExpr'), { minLength: 2, maxLength: 3 }).map((members): TypeExpr => ({ kind: 'intersection', members })),
    fc.record({ readonly: fc.boolean(), element: tie('typeExpr') }).map((value): TypeExpr => ({ kind: 'array', ...value })),
    fc.record({ readonly: fc.boolean(), elements: fc.array(tie('typeExpr'), { maxLength: 3 }) }).map((value): TypeExpr => ({ kind: 'tuple', ...value })),
    tie('signature').map((signature): TypeExpr => ({ kind: 'function', signature })),
    fc.array(tie('member'), { maxLength: 3 }).map((members): TypeExpr => ({ kind: 'object', members })),
    fc.string({ unit, minLength: 1, maxLength: 6 }).map((text): TypeExpr => ({ kind: 'text', text })),
  ),
  typeParameters: fc.array(
    fc.record({ name, constraint: tie('typeExpr'), default: tie('typeExpr') }, { requiredKeys: ['name'] }),
    { maxLength: 2 },
  ),
  signature: fc.record({
    typeParameters: tie('typeParameters') as fc.Arbitrary<ReadonlyArray<TypeParameter>>,
    parameters: fc.array(
      fc.record({ name, type: tie('typeExpr'), optional: fc.boolean(), rest: fc.boolean() }) as fc.Arbitrary<Parameter>,
      { maxLength: 3 },
    ),
    returns: tie('typeExpr'),
  }) as fc.Arbitrary<Signature>,
  member: fc.oneof(
    fc.record({ kind: fc.constant('property' as const), name, optional: fc.boolean(), readonly: fc.boolean(), type: tie('typeExpr') }),
    fc.record({ kind: fc.constant('method' as const), name, optional: fc.boolean(), signatures: fc.array(tie('signature'), { minLength: 1, maxLength: 2 }) }),
    tie('signature').map((signature): Member => ({ kind: 'call', signature })),
  ),
}))

/** Any type expression. */
export { typeExpr }

const typeAlias: fc.Arbitrary<TypeAliasItem> = fc.record({
  kind: fc.constant('typeAlias' as const),
  name,
  typeParameters,
  type: typeExpr,
})

const leafItem: fc.Arbitrary<ApiItem> = fc.oneof(
  fc.record({ kind: fc.constant('function' as const), name, signatures: fc.array(fc.record({ typeParameters, parameters: fc.constant([]), returns: typeExpr }) as fc.Arbitrary<Signature>, { minLength: 1, maxLength: 2 }) }),
  fc.record({ kind: fc.constant('variable' as const), name, constant: fc.boolean(), type: typeExpr }),
  typeAlias,
  fc.record({
    kind: fc.constant('interface' as const),
    name,
    typeParameters,
    extends: fc.array(typeExpr, { maxLength: 2 }),
    members: fc.array(member, { maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('class' as const),
    name,
    abstract: fc.boolean(),
    typeParameters,
    extends: fc.array(typeExpr, { maxLength: 1 }),
    implements: fc.array(typeExpr, { maxLength: 2 }),
    members: fc.array(member, { maxLength: 3 }),
  }),
  fc.record({ kind: fc.constant('enum' as const), name, const: fc.boolean(), members: fc.uniqueArray(fc.record({ name }), { selector: (member) => member.name, maxLength: 3 }) }),
)

/** Items with unique names, as a module's exports are. */
export const items: fc.Arbitrary<ReadonlyArray<ApiItem>> = fc.uniqueArray(
  fc.oneof(
    { weight: 4, arbitrary: leafItem },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('namespace' as const), name, items: fc.uniqueArray(leafItem, { selector: (item) => item.name, maxLength: 3 }) }) },
  ),
  { selector: (item) => item.name, maxLength: 5 },
)

const entryPoint: fc.Arbitrary<EntryPoint> = fc.record({
  path: fc.oneof(fc.constant('.'), name.map((segment) => `./${segment}`)),
  items,
  locals: fc.uniqueArray(typeAlias, { selector: (alias) => alias.name, maxLength: 2 }),
})

/** Any well-formed model. */
export const apiModel: fc.Arbitrary<ApiModel> = fc.record({
  schemaVersion: fc.constant(API_MODEL_SCHEMA_VERSION),
  producer: fc.record({ engine: fc.constant('test@0.0.0'), declarations: fc.constantFrom('tsc@7.0.2', 'isolated') }),
  package: fc.record({ name, version: fc.constant('1.0.0') }),
  entryPoints: fc.uniqueArray(entryPoint, { selector: (entry) => entry.path, minLength: 1, maxLength: 2 }),
})
