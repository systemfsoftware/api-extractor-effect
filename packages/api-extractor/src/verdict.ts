import { canonicalJson, compareCodeUnits } from './canonical-json.ts'
import type { Change } from './diff/change.ts'
import { diffModels } from './diff/diff.ts'
import type { ApiModel } from './model/api-model.ts'
import { type Bump, defaultCorpus, type Rule, type RuleCorpus } from './rules/corpus.ts'
import { ENGINE } from './version.ts'

/** The verdict document's wire version. */
export const VERDICT_SCHEMA_VERSION = 1

export interface Finding {
  readonly rule_id: string
  readonly reason_code: string
  readonly bump: Bump
  readonly next_action: string
  readonly locations: ReadonlyArray<string>
}

export interface Verdict {
  readonly schemaVersion: typeof VERDICT_SCHEMA_VERSION
  readonly engine: string
  readonly corpusVersion: string
  readonly declarations: { readonly before: string; readonly after: string }
  readonly bump: Bump
  readonly findings: ReadonlyArray<Finding>
}

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

/** Judges every change between two models against a rule corpus. */
export const verdict = (before: ApiModel, after: ApiModel, corpus: RuleCorpus = defaultCorpus): Verdict => {
  const changes = diffModels(before, after, corpus.channelTypes)
  const grouped = new Map<string, { readonly rule: Rule; readonly locations: ReadonlySet<string> }>()
  for (const change of changes) {
    const rule = classify(corpus, change)
    const current = grouped.get(rule.rule_id)
    grouped.set(rule.rule_id, { rule, locations: new Set([...(current?.locations ?? []), change.location]) })
  }
  const findings = [...grouped.values()]
    .map(({ rule, locations }): Finding => ({
      rule_id: rule.rule_id,
      reason_code: rule.reason_code,
      bump: rule.bump,
      next_action: rule.next_action,
      locations: [...locations].sort(compareCodeUnits),
    }))
    .sort((left, right) => compareCodeUnits(left.rule_id, right.rule_id))
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    engine: ENGINE,
    corpusVersion: corpus.corpusVersion,
    declarations: { before: before.producer.declarations, after: after.producer.declarations },
    bump: findings.reduce<Bump>((bump, finding) => maxBump(bump, finding.bump), 'none'),
    findings,
  }
}

/** The verdict as canonical JSON bytes. */
export const serialiseVerdict = (value: Verdict): string => canonicalJson(value)
