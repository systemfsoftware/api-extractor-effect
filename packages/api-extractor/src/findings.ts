import { Array as Arr } from 'effect'
import { compareCodeUnits } from './canonical-json.ts'
import type { Change } from './diff/change.ts'
import type { Bump, Rule, RuleCorpus, RuleMatch } from './rules/corpus.ts'
import type { Finding } from './verdict.schema.ts'

const BUMP_ORDER: ReadonlyArray<Bump> = ['none', 'patch', 'minor', 'major']

/** The larger of two bumps. */
export const maxBump = (left: Bump, right: Bump): Bump =>
  BUMP_ORDER.indexOf(left) >= BUMP_ORDER.indexOf(right) ? left : right

/** A change no rule classifies: reported as major, never dropped. */
export const UNCLASSIFIED: Rule = {
  rule_id: 'unclassified-change',
  match: { kind: 'type-changed' },
  bump: 'major',
  reason_code: 'UNCLASSIFIED_CHANGE',
  next_action: 'Declare a major bump, or add a rule for this change to the corpus.',
}

const specificity = (rule: Rule): number =>
  [rule.match.position, rule.match.channel, rule.match.direction].filter((field) => field !== undefined).length

const matches = (rule: Rule, change: Change): boolean =>
  rule.match.kind === change.kind &&
  (rule.match.position === undefined || rule.match.position === change.position) &&
  (rule.match.channel === undefined || rule.match.channel === change.channel) &&
  (rule.match.direction === undefined || rule.match.direction === change.direction)

/** The most specific matching rule; among equally specific rules, the first in corpus order. */
export const classify = (corpus: RuleCorpus, change: Change): Rule =>
  corpus.rules
    .filter((rule) => matches(rule, change))
    .reduce<Rule | undefined>((best, rule) => (best === undefined || specificity(rule) > specificity(best) ? rule : best), undefined) ??
  UNCLASSIFIED

/** One finding per rule that fired, ordered by rule id, each with its distinct locations in code-unit order. */
export const findingsOf = (corpus: RuleCorpus, changes: ReadonlyArray<Change>): ReadonlyArray<Finding> =>
  Object.values(Arr.groupBy(changes.map((change) => ({ rule: classify(corpus, change), location: change.location })), ({ rule }) => rule.rule_id))
    .map((group): Finding => ({
      rule_id: group[0].rule.rule_id,
      reason_code: group[0].rule.reason_code,
      bump: group[0].rule.bump,
      next_action: group[0].rule.next_action,
      locations: Arr.dedupe(group.map(({ location }) => location)).sort(compareCodeUnits),
    }))
    .sort((left, right) => compareCodeUnits(left.rule_id, right.rule_id))

/** The highest bump among the findings; `none` when there are none. */
export const bumpOf = (findings: ReadonlyArray<Finding>): Bump =>
  findings.reduce<Bump>((bump, finding) => maxBump(bump, finding.bump), 'none')

const matchKey = (match: RuleMatch): string =>
  [match.kind, match.position ?? '*', match.channel ?? '*', match.direction ?? '*'].join('|')

const repeated = (keys: ReadonlyArray<string>, describe: (key: string) => string): ReadonlyArray<string> =>
  Object.entries(Arr.groupBy(keys, (key) => key))
    .filter(([, group]) => group.length > 1)
    .map(([key]) => describe(key))
    .sort(compareCodeUnits)

/** Why a corpus cannot pick one rule per change: rules sharing a match, and repeated rule ids. */
export const ambiguitiesOf = (corpus: RuleCorpus): ReadonlyArray<string> => [
  ...repeated(corpus.rules.map((rule) => matchKey(rule.match)), (key) => `two rules match ${key}`),
  ...repeated(corpus.rules.map((rule) => rule.rule_id), (id) => `duplicate rule id ${id}`),
]
