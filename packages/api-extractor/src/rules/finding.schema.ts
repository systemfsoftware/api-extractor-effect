import { Array as Arr, Function, Order, Schema } from 'effect'
import type { Changes } from '../diff/change.schema.ts'
import { Bump, classify, maxBump, type RuleCorpus } from './corpus.schema.ts'

/** One rule that fired, with every location it fired at. */
export const Finding = Schema.Struct({
  rule_id: Schema.String,
  reason_code: Schema.String,
  bump: Bump,
  next_action: Schema.String,
  locations: Schema.Array(Schema.String),
})
export type Finding = typeof Finding.Type

/** Every rule that fired, ordered by rule id. */
export const Findings = Schema.Array(Finding)
export type Findings = typeof Findings.Type

/** One finding per rule that fired, ordered by rule id, each with its distinct locations in code-unit order. */
export const findingsOf: {
  (changes: Changes): (corpus: RuleCorpus) => Findings
  (corpus: RuleCorpus, changes: Changes): Findings
} = Function.dual(2, (corpus: RuleCorpus, changes: Changes): Findings =>
  Object.values(Arr.groupBy(changes.map((change) => ({ rule: classify(corpus, change), location: change.location })), ({ rule }) => rule.rule_id))
    .map((group): Finding => {
      const { rule_id, reason_code, bump, next_action } = group[0].rule
      return { rule_id, reason_code, bump, next_action, locations: Arr.dedupe(group.map(({ location }) => location)).sort(Order.String) }
    })
    .sort((left, right) => Order.String(left.rule_id, right.rule_id)))

/** The highest bump among the findings; `none` when there are none. */
export const bumpOf = (findings: Findings): Bump =>
  findings.reduce<Bump>((bump, finding) => maxBump(bump, finding.bump), 'none')
