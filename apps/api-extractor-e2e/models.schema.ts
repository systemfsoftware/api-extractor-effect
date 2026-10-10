import { ApiModel } from '@systemfsoftware/api-extractor'
import { Schema } from 'effect'

export interface ProbeResult {
  readonly locale: string
  readonly timeZone: string
  readonly cwd: string
  readonly outputs: ReadonlyArray<string>
}

export const ProbeResult: Schema.Codec<ProbeResult> = Schema.Struct({
  locale: Schema.String,
  timeZone: Schema.String,
  cwd: Schema.String,
  outputs: Schema.Array(Schema.String),
})

export const ProbeReport = Schema.fromJsonString(ProbeResult)

export const Models = Schema.Array(ApiModel.ApiModel).check(Schema.isBetweenLength(2, 4))

export const ModelsJson = Schema.fromJsonString(Models)
