import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ApiModel } from '@systemfsoftware/api-extractor'
import { Arbitrary, Effect, Layer, Schema } from 'effect'
import { empty, functionItem, META, ref, rootedWith, signature } from './__fixtures__/surfaces.ts'

type Model = ApiModel.ApiModel
type Item = ApiModel.ApiItem

const Feature = makeFeature({ it })

const value: Item = { kind: 'variable', name: 'Shared', constant: true, type: ref('A'), ...META }
const type: Item = { kind: 'typeAlias', name: 'Shared', typeParameters: [], type: ref('B'), ...META }
const first: Item = functionItem(signature([], ref('A')))
const second: Item = functionItem(signature([], ref('B')))

const bytePairs = (left: Model, right: Model) => ({ left: ApiModel.serialise(left), right: ApiModel.serialise(right) })

const SAMPLE_COUNT = 50
const sample = Arbitrary.sampleEffect(Arbitrary.schema(ApiModel.ApiModel), { count: SAMPLE_COUNT, seed: 20261010 })

const reversed = (model: Model): Model => ({
  ...model,
  entryPoints: [...model.entryPoints].reverse().map((entry) => ({ ...entry, items: [...entry.items].reverse() })),
})

const decodeBytes = Schema.decodeEffect(Schema.fromJsonString(ApiModel.ApiModel))

const roundOf = (bytes: string) => Effect.map(decodeBytes(bytes), (decoded) => ({ bytes, again: ApiModel.serialise(decoded) }))

const otherVersion: Schema.Json = {
  schemaVersion: 1,
  producer: { engine: 'fixture@0.0.0', declarations: 'hand-written' },
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: [],
}

const previousVersion: Schema.Json = {
  schemaVersion: 2,
  producer: { engine: 'fixture@0.0.0', declarations: 'hand-written' },
  package: { name: 'fixture', version: '1.0.0', exports: [], imports: [] },
  anchorBase: 'package',
  entryPoints: [],
  messages: [],
  coverage: { complete: true, reasons: [] },
}

Feature('The serialised model is a canonical, versioned form of the surface')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'every generated model reads back from its canonical bytes to the same bytes',
      Gherkin.Do.pipe(
        Given('a fixed sample of generated models')('models', () => sample),
        When('each model is serialised, decoded and serialised again')('rounds', (scope) =>
          Effect.forEach(scope.models.map((model) => ApiModel.serialise(model)), roundOf),
        ),
        Then('every second serialisation equals the first')((scope, expect) =>
          expect(scope.rounds.filter((round) => round.again !== round.bytes)).toEqual([]),
        ),
      ),
    )

    scenario(
      'every generated model serialises the same whatever order its exports arrive in',
      Gherkin.Do.pipe(
        Given('a fixed sample of generated models')('models', () => sample),
        When('each model and its reversal are serialised')('pairs', (scope) => Effect.sync(() => scope.models.map((model) => bytePairs(model, reversed(model))))),
        Then('every pair of byte strings is equal')((scope, expect) => expect(scope.pairs.filter((pair) => pair.left !== pair.right)).toEqual([])),
      ),
    )

    scenario(
      'two exports stored in opposite order serialise to the same bytes',
      Gherkin.Do.pipe(
        Given('two models storing the same two exports in opposite order')('models', () =>
          Effect.sync(() => ({ left: rootedWith(empty, [first, second]), right: rootedWith(empty, [second, first]) })),
        ),
        When('each model is serialised to canonical bytes')('bytes', (scope) => Effect.sync(() => bytePairs(scope.models.left, scope.models.right))),
        Then('the two byte strings are equal')((scope, expect) => expect(scope.bytes.left).toBe(scope.bytes.right)),
      ),
    )

    scenario(
      'a value and a type sharing a name serialise the same in either order',
      Gherkin.Do.pipe(
        Given('a value and a type sharing a name, stored in either order')('models', () =>
          Effect.sync(() => ({ left: rootedWith(empty, [value, type]), right: rootedWith(empty, [type, value]) })),
        ),
        When('each model is serialised to canonical bytes')('bytes', (scope) => Effect.sync(() => bytePairs(scope.models.left, scope.models.right))),
        Then('the two byte strings are equal')((scope, expect) => expect(scope.bytes.left).toBe(scope.bytes.right)),
      ),
    )

    scenario(
      'a model declaring an older schema version is refused',
      Gherkin.Do.pipe(
        Given('an encoded model declaring schema version 1')('encoded', () => Effect.succeed(otherVersion)),
        When('the model is decoded')('refusal', (scope) =>
          Effect.flip(Effect.try({ try: () => ApiModel.decode(scope.encoded), catch: String })),
        ),
        Then('the refusal names the schema version')((scope, expect) =>
          expect(scope.refusal).toSatisfy((message: string) => message.includes('schemaVersion'), 'the refusal names schemaVersion'),
        ),
      ),
    )

    scenario(
      'a model declaring the previous schema version, version 2, is refused',
      Gherkin.Do.pipe(
        Given('an encoded model declaring schema version 2')('encoded', () => Effect.succeed(previousVersion)),
        When('the model is decoded')('refusal', (scope) =>
          Effect.flip(Effect.try({ try: () => ApiModel.decode(scope.encoded), catch: String })),
        ),
        Then('the refusal names the schema version')((scope, expect) =>
          expect(scope.refusal).toSatisfy((message: string) => message.includes('schemaVersion'), 'the refusal names schemaVersion'),
        ),
      ),
    )
  })
