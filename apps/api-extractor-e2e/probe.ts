import { NodeServices } from '@effect/platform-node'
import { Effect, Schema, Stdio, Stream } from 'effect'
import { ModelsJson } from './models.schema.ts'
import { outputsOf } from './outputs.ts'

const program = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const input = yield* stdio.stdin.pipe(Stream.decodeText, Stream.mkString)
  const models = yield* Schema.decodeEffect(ModelsJson)(input)
  const options = new Intl.DateTimeFormat().resolvedOptions()
  const report = JSON.stringify({
    locale: options.locale,
    timeZone: options.timeZone,
    cwd: process.cwd(),
    outputs: outputsOf(models),
  })
  yield* Stream.run(Stream.make(report), stdio.stdout())
})

await Effect.runPromise(Effect.provide(program, NodeServices.layer))
