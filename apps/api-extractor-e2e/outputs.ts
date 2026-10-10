import { ApiModel, Verdict } from '@systemfsoftware/api-extractor'
import { Array as Arr, Effect } from 'effect'

export const outputsOf = (models: ReadonlyArray<ApiModel.ApiModel>): ReadonlyArray<string> => [
  ...models.map(ApiModel.serialise),
  ...Arr.zip(models, models.slice(1)).map(([before, after]) =>
    Effect.runSync(Verdict.cell.run({ before, after })),
  ),
]
