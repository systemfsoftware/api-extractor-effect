import { Array as Arr, Function as Fn, Match, Option, Order, Predicate, Schema, SchemaTransformation } from 'effect'

type EncodedConditions = { readonly [condition: string]: EncodedExportTarget }

export type EncodedExportTarget = string | null | ReadonlyArray<EncodedExportTarget> | EncodedConditions

const EncodedExportTarget: Schema.Codec<EncodedExportTarget> = Schema.suspend((): Schema.Codec<EncodedExportTarget> =>
  Schema.Union([Schema.String, Schema.Null, Schema.Array(EncodedExportTarget), Schema.Record(Schema.String, EncodedExportTarget)]),
).annotate({ recursionBudget: { maxDepth: 6, depthSize: 'small' } })

const PathTag = { _tag: 'Path' } as const
type PathTag = typeof PathTag

const ConditionsTag = { _tag: 'Conditions' } as const
type ConditionsTag = typeof ConditionsTag

const FallbacksTag = { _tag: 'Fallbacks' } as const
type FallbacksTag = typeof FallbacksTag

const ExcludedTag = { _tag: 'Excluded' } as const
type ExcludedTag = typeof ExcludedTag

interface ExportPath extends PathTag {
  readonly path: string
}

interface ExportConditions extends ConditionsTag {
  readonly conditions: { readonly [condition: string]: ExportTarget }
}

interface ExportFallbacks extends FallbacksTag {
  readonly targets: ReadonlyArray<ExportTarget>
}

interface ExportExcluded extends ExcludedTag {}

export type ExportTarget = ExportPath | ExportConditions | ExportFallbacks | ExportExcluded

const ExportPath: Schema.Codec<ExportPath> = Schema.TaggedStruct('Path', { path: Schema.String })

const ExportExcluded: Schema.Codec<ExportExcluded> = Schema.TaggedStruct('Excluded', {})

const ExportConditions: Schema.Codec<ExportConditions> = Schema.suspend((): Schema.Codec<ExportConditions> =>
  Schema.TaggedStruct('Conditions', { conditions: Schema.Record(Schema.String, ExportTarget) }),
)

const ExportFallbacks: Schema.Codec<ExportFallbacks> = Schema.suspend((): Schema.Codec<ExportFallbacks> =>
  Schema.TaggedStruct('Fallbacks', { targets: Schema.Array(ExportTarget) }),
)

export const ExportTarget: Schema.Codec<ExportTarget> = Schema.suspend((): Schema.Codec<ExportTarget> =>
  Schema.Union([ExportPath, ExportConditions, ExportFallbacks, ExportExcluded]),
).annotate({ recursionBudget: { maxDepth: 6, depthSize: 'small' } })

const isEncodedArray = (target: EncodedExportTarget): target is ReadonlyArray<EncodedExportTarget> => Array.isArray(target)

const isEncodedConditions = (target: EncodedExportTarget): target is EncodedConditions =>
  Predicate.isObject(target) && !isEncodedArray(target)

const conditionsOf = (conditions: EncodedConditions): { readonly [condition: string]: ExportTarget } =>
  Object.fromEntries(Object.entries(conditions).map(([condition, target]) => [condition, exportTargetOf(target)] as const))

function exportTargetOf(encoded: EncodedExportTarget): ExportTarget {
  return Match.value(encoded).pipe(
    Match.when(Match.string, (path) => ExportPath.make({ path })),
    Match.when(isEncodedArray, (targets) => ExportFallbacks.make({ targets: targets.map(exportTargetOf) })),
    Match.when(isEncodedConditions, (conditions) => ExportConditions.make({ conditions: conditionsOf(conditions) })),
    Match.orElse(() => ExportExcluded.make({})),
  )
}

const encodedConditionsOf = (conditions: { readonly [condition: string]: ExportTarget }): EncodedConditions =>
  Object.fromEntries(Object.entries(conditions).map(([condition, target]) => [condition, encodedOf(target)] as const))

function encodedOf(target: ExportTarget): EncodedExportTarget {
  return Match.value(target).pipe(
    Match.tag('Path', ({ path }) => path),
    Match.tag('Fallbacks', ({ targets }) => targets.map(encodedOf)),
    Match.tag('Conditions', ({ conditions }) => encodedConditionsOf(conditions)),
    Match.tag('Excluded', () => null),
    Match.exhaustive,
  )
}

export const ExportTargetCodec: Schema.Codec<ExportTarget, EncodedExportTarget> = EncodedExportTarget.pipe(
  Schema.decodeTo(ExportTarget, SchemaTransformation.transform<ExportTarget, EncodedExportTarget>({ decode: exportTargetOf, encode: encodedOf })),
)

type PackageManifestFields = {
  readonly name: Schema.String
  readonly version: Schema.String
  readonly exports: Schema.optionalKey<Schema.Union<readonly [Schema.String, Schema.$Record<Schema.String, typeof ExportTargetCodec>]>>
  readonly imports: Schema.optionalKey<Schema.$Record<Schema.String, typeof ExportTargetCodec>>
}

export const PackageManifest: Schema.Struct<PackageManifestFields> = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  exports: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, ExportTargetCodec)])),
  imports: Schema.optionalKey(Schema.Record(Schema.String, ExportTargetCodec)),
})
export type PackageManifest = typeof PackageManifest.Type

/** A target reduced to the path a consumer resolves and the condition that selected it. */
export type ResolvedTarget = {
  readonly path: string
  readonly condition: string | null
}

const CONDITION_FALLBACKS = ['types', 'import', 'default'] as const

const conditionOrder = (preferred: string): ReadonlyArray<string> => [
  preferred,
  ...CONDITION_FALLBACKS.filter((condition) => condition !== preferred),
]

const firstResolved = (options: ReadonlyArray<Option.Option<ResolvedTarget>>): Option.Option<ResolvedTarget> =>
  Arr.match(Arr.getSomes(options), {
    onEmpty: () => Option.none<ResolvedTarget>(),
    onNonEmpty: (resolved) => Option.some(Arr.headNonEmpty(resolved)),
  })

const declaredCondition = (conditions: { readonly [condition: string]: ExportTarget }, condition: string): Option.Option<ExportTarget> =>
  Object.hasOwn(conditions, condition) ? Option.fromNullishOr(conditions[condition]) : Option.none()

const conditionEntries = (
  conditions: { readonly [condition: string]: ExportTarget },
  preferred: string,
): ReadonlyArray<readonly [string, ExportTarget]> => {
  const ordered = conditionOrder(preferred)
  const named = ordered.flatMap((condition) =>
    Option.match(declaredCondition(conditions, condition), {
      onNone: () => Arr.empty<readonly [string, ExportTarget]>(),
      onSome: (target) => [[condition, target] as const],
    }))
  const rest = Object.entries(conditions)
    .filter(([condition]) => !ordered.includes(condition))
    .sort(([left], [right]) => Order.String(left, right))
  return [...named, ...rest]
}

function targetPathIn(target: ExportTarget, preferred: string): Option.Option<ResolvedTarget> {
  return Match.value(target).pipe(
    Match.tag('Path', ({ path }) => Option.some<ResolvedTarget>({ path, condition: null })),
    Match.tag('Conditions', ({ conditions }) =>
      firstResolved(
        conditionEntries(conditions, preferred).map(([condition, chosen]) =>
          Option.map(targetPathIn(chosen, preferred), (resolved) => ({ path: resolved.path, condition })),
        ),
      )),
    Match.tag('Fallbacks', ({ targets }) => firstResolved(targets.map((fallback) => targetPathIn(fallback, preferred)))),
    Match.tag('Excluded', () => Option.none<ResolvedTarget>()),
    Match.exhaustive,
  )
}

/**
 * The target a consumer resolves: the requested condition, then `types`, `import`,
 * `default`, then the first remaining key by code unit. A bare path resolves as itself
 * with no condition; an array resolves through its first target that yields a path.
 */
export const targetPathOf: {
  (target: ExportTarget, preferred: string): Option.Option<ResolvedTarget>
  (target: ExportTarget): (preferred: string) => Option.Option<ResolvedTarget>
} = Fn.dual(2, targetPathIn)

/** A manifest string target, as a target the resolver understands. */
export const pathTargetOf = (path: string): ExportTarget => ExportPath.make({ path })
