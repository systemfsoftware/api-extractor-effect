import { Schema } from 'effect'

export const AnalysisMessageId: Schema.Literals<
  readonly [
    'ae-forgotten-export',
    'ae-incompatible-release-tags',
    'ae-internal-missing-underscore',
    'ae-internal-mixed-release-tag',
    'ae-missing-release-tag',
  ]
> = Schema.Literals([
  'ae-forgotten-export',
  'ae-incompatible-release-tags',
  'ae-internal-missing-underscore',
  'ae-internal-mixed-release-tag',
  'ae-missing-release-tag',
])
export type AnalysisMessageId = typeof AnalysisMessageId.Type

export type AnalysisMessage = {
  readonly messageId: AnalysisMessageId
  readonly entryPoint: string
  readonly item: string
  readonly symbol: string
}

export const AnalysisMessage: Schema.Codec<AnalysisMessage> = Schema.Struct({
  messageId: AnalysisMessageId,
  entryPoint: Schema.String,
  item: Schema.String,
  symbol: Schema.String,
})
