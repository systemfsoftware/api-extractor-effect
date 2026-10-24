import { Schema } from 'effect'
import { Anchor } from './anchor.schema.ts'

const ANALYSIS_MESSAGE_IDS = [
  'ae-forgotten-export',
  'ae-incompatible-release-tags',
  'ae-internal-missing-underscore',
  'ae-internal-mixed-release-tag',
  'ae-missing-release-tag',
] as const

export const AnalysisMessageId: Schema.Literals<typeof ANALYSIS_MESSAGE_IDS> = Schema.Literals(ANALYSIS_MESSAGE_IDS)
export type AnalysisMessageId = typeof AnalysisMessageId.Type

/** One analysis finding about one item; `anchor` is the declaration the finding is about. */
export type AnalysisMessage = {
  readonly messageId: AnalysisMessageId
  readonly entryPoint: string
  readonly item: string
  readonly symbol: string
  readonly anchor: Anchor | null
}

export const AnalysisMessage: Schema.Codec<AnalysisMessage> = Schema.Struct({
  messageId: AnalysisMessageId,
  entryPoint: Schema.String,
  item: Schema.String,
  symbol: Schema.String,
  anchor: Schema.NullOr(Anchor),
})
