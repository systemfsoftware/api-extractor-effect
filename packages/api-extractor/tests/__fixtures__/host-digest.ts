/**
 * Host-variance evidence for R5. Generates a fixed-seed sample of models,
 * serialises every model and the verdict between consecutive models, and writes
 * the bytes to stdout. CI runs this on x86_64 and arm64 hosts and compares the
 * two outputs byte for byte, so no committed golden stands in for either side.
 */
import { Effect } from 'effect'
import fc from 'fast-check'
import { serialiseApiModel } from '../../src/model/serialise.ts'
import { verdictCell } from '../../src/verdict.cell.ts'
import { apiModel } from './arbitraries.ts'

const samples = fc.sample(fc.array(apiModel, { minLength: 2, maxLength: 4 }), { seed: 20261010, numRuns: 200 })
for (const models of samples) {
  for (const model of models) process.stdout.write(serialiseApiModel(model))
  for (const [index, after] of models.slice(1).entries()) process.stdout.write(Effect.runSync(verdictCell.run({ before: models[index]!, after })))
}
