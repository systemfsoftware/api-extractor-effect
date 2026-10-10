import { ApiModel } from '@systemfsoftware/api-extractor'
import { Arbitrary, Effect, Schema } from 'effect'
import { outputsOf } from './outputs.ts'

const Models = Schema.Array(ApiModel.ApiModel).check(Schema.isBetweenLength(2, 4))
const samples = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(Models), { count: 200, seed: 20261010 }))
process.stdout.write(samples.flatMap(outputsOf).join(''))
