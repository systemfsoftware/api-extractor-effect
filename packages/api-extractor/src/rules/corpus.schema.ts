import { Array as Arr, Function, Option, Order, Schema } from 'effect'
import type { Json } from '../canonical-json.schema.ts'
import { type Change, ChangeKind } from '../diff/change.schema.ts'
import { Direction } from '../diff/direction.schema.ts'
import { ChannelType, Position } from '../diff/position.schema.ts'

export const Bump = Schema.Literals(['none', 'patch', 'minor', 'major'])
export type Bump = typeof Bump.Type

export type RuleMatch = {
  readonly kind: ChangeKind
  readonly position?: Position
  readonly channel?: string
  readonly direction?: Direction
}

export type Rule = {
  readonly rule_id: string
  readonly match: RuleMatch
  readonly bump: Bump
  readonly reason_code: string
  readonly next_action: string
}

export type RuleCorpus = {
  readonly corpusVersion: string
  readonly channelTypes: ReadonlyArray<ChannelType>
  readonly rules: ReadonlyArray<Rule>
}

const Rule: Schema.Codec<Rule> = Schema.Struct({
  rule_id: Schema.String,
  match: Schema.Struct({
    kind: ChangeKind,
    position: Schema.optionalKey(Position),
    channel: Schema.optionalKey(Schema.String),
    direction: Schema.optionalKey(Direction),
  }),
  bump: Bump,
  reason_code: Schema.String,
  next_action: Schema.String,
})

export const RuleCorpus: Schema.Codec<RuleCorpus> = Schema.Struct({
  corpusVersion: Schema.String,
  channelTypes: Schema.Array(ChannelType),
  rules: Schema.Array(Rule),
})

/** Decodes a rule corpus; whether its rules are unambiguous is the verdict decision's to judge. */
export const decodeRuleCorpus: (input: Json) => RuleCorpus = Schema.decodeUnknownSync(RuleCorpus)

/** Semver order, least first: the order `Bump` declares its literals in. */
const BUMP_ORDER: ReadonlyArray<Bump> = Bump.literals

/** The larger of two bumps. */
export const maxBump: {
  (right: Bump): (left: Bump) => Bump
  (left: Bump, right: Bump): Bump
} = Function.dual(2, (left: Bump, right: Bump): Bump => (BUMP_ORDER.indexOf(left) >= BUMP_ORDER.indexOf(right) ? left : right))

/** A change no rule classifies: reported as major, never dropped. */
export const UNCLASSIFIED: Rule = {
  rule_id: 'unclassified-change',
  match: { kind: 'type-changed' },
  bump: 'major',
  reason_code: 'UNCLASSIFIED_CHANGE',
  next_action: 'Declare a major bump, or add a rule for this change to the corpus.',
}

/** The optional fields a rule may narrow its match with. */
const MATCH_FIELDS = ['position', 'channel', 'direction'] as const

const specificity = (rule: Rule): number => MATCH_FIELDS.filter((field) => rule.match[field] !== undefined).length

/** Most specific first; the sort is stable, so corpus order breaks ties. */
const bySpecificity: Order.Order<Rule> = Order.flip(Order.mapInput(Order.Number, specificity))

/** A field a rule leaves out matches anything. */
const agrees = (stated: string | undefined, actual: string | undefined): boolean => stated === undefined || stated === actual

const matches = (rule: Rule, change: Change): boolean =>
  rule.match.kind === change.kind && MATCH_FIELDS.every((field) => agrees(rule.match[field], change[field]))

/** The most specific matching rule; a corpus `ambiguitiesOf` accepts never has two equally specific ones. */
export const classify: {
  (change: Change): (corpus: RuleCorpus) => Rule
  (corpus: RuleCorpus, change: Change): Rule
} = Function.dual(
  2,
  (corpus: RuleCorpus, change: Change): Rule =>
    Option.getOrElse(
      Arr.head(Arr.sort(
        corpus.rules.filter((rule) => matches(rule, change)),
        bySpecificity,
      )),
      () => UNCLASSIFIED,
    ),
)

const matchKey = (match: RuleMatch): string => [match.kind, ...MATCH_FIELDS.map((field) => match[field] ?? '*')].join('|')

const repeated = (keys: ReadonlyArray<string>, describe: (key: string) => string): ReadonlyArray<string> =>
  Object.entries(Arr.groupBy(keys, (key) => key))
    .filter(([, group]) => group.length > 1)
    .map(([key]) => describe(key))
    .sort(Order.String)

/** Some change matches both rules: same kind, and every field both rules state agrees. */
const compatible = (left: string | undefined, right: string | undefined): boolean => [left, right].includes(undefined) || left === right

const overlap = (left: RuleMatch, right: RuleMatch): boolean =>
  left.kind === right.kind && MATCH_FIELDS.every((field) => compatible(left[field], right[field]))

/** Pairs of rules that tie on some change: they overlap and neither is more specific, so corpus order would decide. */
const ties = (rules: ReadonlyArray<Rule>): ReadonlyArray<string> =>
  Arr.dedupe(
    rules.flatMap((left, index) =>
      rules
        .slice(index + 1)
        .filter((right) => specificity(left) === specificity(right) && overlap(left.match, right.match))
        .map((right) => {
          const [first, second] = [matchKey(left.match), matchKey(right.match)].sort(Order.String)
          return first === second ? `two rules match ${first}` : `two rules match ${first} and ${second}`
        }),
    ),
  ).sort(Order.String)

/** Why a corpus cannot pick one rule per change: rules that tie, repeated rule ids, and a rule taking the fallback's id. */
export const ambiguitiesOf = (corpus: RuleCorpus): ReadonlyArray<string> => [
  ...ties(corpus.rules),
  ...repeated(corpus.rules.map((rule) => rule.rule_id), (id) => `duplicate rule id ${id}`),
  ...(corpus.rules.some((rule) => rule.rule_id === UNCLASSIFIED.rule_id) ? [`rule id ${UNCLASSIFIED.rule_id} is reserved for unclassified changes`] : []),
]
