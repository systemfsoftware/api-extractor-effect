import corpusV1 from './corpus.v1.json' with { type: 'json' }
import { decodeRuleCorpus, type RuleCorpus } from './corpus.schema.ts'

/** The rule corpus this engine ships. */
export const defaultCorpus: RuleCorpus = decodeRuleCorpus(corpusV1)
