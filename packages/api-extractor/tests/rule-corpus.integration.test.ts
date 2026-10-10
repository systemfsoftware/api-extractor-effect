import { describe } from '@systemfsoftware/vitest'
import { Verdict } from '../src/mod.ts'

const { ChangeKind, Direction, Position, classify, defaultCorpus } = Verdict

describe('the shipped rule corpus', (it) => {
  it('classifies every change kind the diff emits, so none falls through to UNCLASSIFIED_CHANGE', function* ({ expect }) {
    yield* expect(ChangeKind.literals.filter((kind) => !defaultCorpus.rules.some((rule) => rule.match.kind === kind))).toEqual([])
  })

  it('has no dead rule: each one is the classification of some change', function* ({ expect }) {
    const channels = [undefined, ...defaultCorpus.channelTypes.flatMap((type) => type.channels.map((slot) => slot.name))]
    const directions = [undefined, ...Direction.literals]
    const changes = ChangeKind.literals.flatMap((kind) =>
      Position.literals.flatMap((position) =>
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
    const fired = new Set(changes.map((change) => classify(defaultCorpus, change).rule_id))
    yield* expect(defaultCorpus.rules.map((rule) => rule.rule_id).filter((id) => !fired.has(id))).toEqual([])
  })
})
