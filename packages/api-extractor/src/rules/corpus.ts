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

/** Decodes a rule corpus; whether its rules are unambiguous is the verdict decision's to judge. */
export const decodeRuleCorpus: (input: unknown) => RuleCorpus = Schema.decodeUnknownSync(RuleCorpus)

/** The rule corpus this engine ships. */
export const defaultCorpus: RuleCorpus = decodeRuleCorpus(corpusV1)
