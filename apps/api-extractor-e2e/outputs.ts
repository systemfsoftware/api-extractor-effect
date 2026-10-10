import { ApiModel, Verdict } from '@systemfsoftware/api-extractor'
import { Effect } from 'effect'

/** The bytes the determinism checks compare: every model, then the verdict between each consecutive pair. */
export const outputsOf = (models: ReadonlyArray<ApiModel.ApiModel>): ReadonlyArray<string> => [
  ...models.map(ApiModel.serialise),
  ...models.slice(1).map((after, index) => Effect.runSync(Verdict.cell.run({ before: models[index]!, after }))),
]
