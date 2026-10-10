import { Arbitrary, Effect } from 'effect'
import { Models } from './models.schema.ts'
import { outputsOf } from './outputs.ts'

const samples = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(Models), { count: 200, seed: 20261010 }))
process.stdout.write(samples.flatMap(outputsOf).join(''))
