import { Schema } from 'effect'
import { ChangeKind, Direction, Position, Variance } from '../diff/change.ts'
import corpusV1 from './corpus.v1.json' with { type: 'json' }

export const Bump = Schema.Literals(['none', 'patch', 'minor', 'major'])
export type Bump = typeof Bump.Type

/** A generic type whose type arguments are Effect-style channels with a declared variance. */
export interface ChannelType {
  /** Spellings the declarations use for the type, e.g. `Effect` and `Effect.Effect`. */
  readonly names: ReadonlyArray<string>
  /** Packages the type comes from; a reference with no module matches any of them. */
  readonly modules: ReadonlyArray<string>
  readonly channels: ReadonlyArray<{ readonly name: string; readonly variance: Variance }>
}

export interface RuleMatch {
  readonly kind: ChangeKind
  readonly position?: Position
  readonly channel?: string
  readonly direction?: Direction
}

export interface Rule {
  readonly rule_id: string
  readonly match: RuleMatch
  readonly bump: Bump
  readonly reason_code: string
  readonly next_action: string
}

export interface RuleCorpus {
  readonly corpusVersion: string
  readonly channelTypes: ReadonlyArray<ChannelType>
  readonly rules: ReadonlyArray<Rule>
}

const ChannelType: Schema.Codec<ChannelType> = Schema.Struct({
  names: Schema.Array(Schema.String),
  modules: Schema.Array(Schema.String),
  channels: Schema.Array(Schema.Struct({ name: Schema.String, variance: Variance })),
})

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

const matchKey = (match: RuleMatch): string =>
  [match.kind, match.position ?? '*', match.channel ?? '*', match.direction ?? '*'].join('|')

/**
 * Decodes a rule corpus and rejects one whose rules are ambiguous: two rules
 * with the same match, or a repeated rule id.
 */
export const decodeRuleCorpus = (input: unknown): RuleCorpus => {
  const corpus = Schema.decodeUnknownSync(RuleCorpus)(input)
  const seen = new Set<string>()
  const ids = new Set<string>()
  for (const rule of corpus.rules) {
    const key = matchKey(rule.match)
    if (seen.has(key)) throw new Error(`rule corpus ${corpus.corpusVersion}: two rules match ${key}`)
    if (ids.has(rule.rule_id)) throw new Error(`rule corpus ${corpus.corpusVersion}: duplicate rule id ${rule.rule_id}`)
    seen.add(key)
    ids.add(rule.rule_id)
  }
  return corpus
}

/** The rule corpus this engine ships. */
export const defaultCorpus: RuleCorpus = decodeRuleCorpus(corpusV1)
