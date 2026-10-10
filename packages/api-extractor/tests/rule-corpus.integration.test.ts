import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Verdict } from '@systemfsoftware/api-extractor'
import { Effect, Layer } from 'effect'

const Feature = makeFeature({ it })

Feature('The shipped rule corpus classifies every change and keeps no dead rule')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'every change kind the diff emits is classified by some rule',
      Gherkin.Do.pipe(
        Given('the shipped rule corpus')('corpus', () => Effect.sync(() => Verdict.defaultCorpus)),
        When('each declared change kind is looked up in the corpus')('unclassified', (scope) =>
          Effect.sync(() => Verdict.ChangeKind.literals.filter((kind) => !scope.corpus.rules.some((rule) => rule.match.kind === kind))),
        ),
        Then('no change kind falls through to the unclassified rule')((scope, expect) => expect(scope.unclassified).toEqual([])),
      ),
    )

    scenario(
      'every shipped rule classifies at least one change',
      Gherkin.Do.pipe(
        Given('the shipped rule corpus')('corpus', () => Effect.sync(() => Verdict.defaultCorpus)),
        When('every change in the corpus vocabulary is classified')('dead', (scope) =>
          Effect.sync(() => {
            const channels = [undefined, ...scope.corpus.channelTypes.flatMap((type) => type.channels.map((slot) => slot.name))]
            const directions = [undefined, ...Verdict.Direction.literals]
            const changes: ReadonlyArray<Verdict.Change> = Verdict.ChangeKind.literals.flatMap((kind) =>
              Verdict.Position.literals.flatMap((position) =>
                channels.flatMap((channel) =>
                  directions.map(
                    (direction): Verdict.Change => ({
                      kind,
                      location: '.:x',
                      position,
                      ...(channel === undefined ? {} : { channel }),
                      ...(direction === undefined ? {} : { direction }),
                    }),
                  ),
                ),
              ),
            )
            const fired = new Set(changes.map((change) => Verdict.classify(scope.corpus, change).rule_id))
            return scope.corpus.rules.map((rule) => rule.rule_id).filter((id) => !fired.has(id))
          }),
        ),
        Then('no shipped rule is dead')((scope, expect) => expect(scope.dead).toEqual([])),
      ),
    )
  })
