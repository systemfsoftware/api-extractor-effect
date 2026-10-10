import { describe, expect, it } from 'vitest'
import { ChangeKind, Direction, Position } from '../diff/change.ts'
import type { Change } from '../diff/change.ts'
import { classify } from '../findings.ts'
import { defaultCorpus } from './corpus.ts'

describe('the shipped rule corpus', () => {
  it('classifies every change kind the diff emits, so none falls through to UNCLASSIFIED_CHANGE', () => {
    expect(ChangeKind.literals.filter((kind) => !defaultCorpus.rules.some((rule) => rule.match.kind === kind))).toEqual([])
  })

  it('has no dead rule: each one is the classification of some change', () => {
    const channels = [undefined, ...defaultCorpus.channelTypes.flatMap((type) => type.channels.map((slot) => slot.name))]
    const directions = [undefined, ...Direction.literals]
    const changes = ChangeKind.literals.flatMap((kind) =>
      Position.literals.flatMap((position) =>
        channels.flatMap((channel) =>
          directions.map(
            (direction): Change => ({
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
    expect(defaultCorpus.rules.map((rule) => rule.rule_id).filter((id) => !fired.has(id))).toEqual([])
  })
})
