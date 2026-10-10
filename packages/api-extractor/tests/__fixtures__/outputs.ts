import { Effect } from 'effect'
import type { ApiModel } from '../../src/model/api-model.ts'
import { serialiseApiModel } from '../../src/model/serialise.ts'
import { verdictCell } from '../../src/verdict.cell.ts'

/** The bytes the determinism checks compare: every model, then the verdict between each consecutive pair. */
export const outputsOf = (models: ReadonlyArray<ApiModel>): ReadonlyArray<string> => [
  ...models.map(serialiseApiModel),
  ...models.slice(1).map((after, index) => Effect.runSync(verdictCell.run({ before: models[index]!, after }))),
]
