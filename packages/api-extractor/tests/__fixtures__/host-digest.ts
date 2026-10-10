/**
 * Host-variance evidence for R5. Generates a fixed-seed sample of models,
 * serialises every model and the verdict between consecutive models, and writes
 * the bytes to stdout. CI runs this on x86_64 and arm64 hosts and compares the
 * two outputs byte for byte, so no committed golden stands in for either side.
 */
import fc from 'fast-check'
import { apiModel } from './arbitraries.ts'
import { outputsOf } from './outputs.ts'

const samples = fc.sample(fc.array(apiModel, { minLength: 2, maxLength: 4 }), { seed: 20261010, numRuns: 200 })
process.stdout.write(samples.flatMap(outputsOf).join(''))
