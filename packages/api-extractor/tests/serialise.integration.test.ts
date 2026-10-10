import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ApiModel } from '@systemfsoftware/api-extractor'
import { Effect, Layer, type Schema } from 'effect'
import { functionItem, ref, rooted, rootedWith, signature } from './__fixtures__/surfaces.ts'

type Model = ApiModel.ApiModel
type Item = ApiModel.ApiItem

const Feature = makeFeature({ it })

const empty: Model = rooted({
  schemaVersion: ApiModel.SCHEMA_VERSION,
  producer: { engine: 'fixture@0.0.0', declarations: 'hand-written' },
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: [],
})

const value: Item = { kind: 'variable', name: 'Shared', constant: true, type: ref('A') }
const type: Item = { kind: 'typeAlias', name: 'Shared', typeParameters: [], type: ref('B') }
const first: Item = functionItem(signature([], ref('A')))
const second: Item = functionItem(signature([], ref('B')))

const bytePairs = (left: Model, right: Model) => ({ left: ApiModel.serialise(left), right: ApiModel.serialise(right) })

const otherVersion: Schema.Json = {
  schemaVersion: 1,
  producer: { engine: 'fixture@0.0.0', declarations: 'hand-written' },
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: [],
}

Feature('The serialised model is a canonical, versioned form of the surface')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
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
  })
