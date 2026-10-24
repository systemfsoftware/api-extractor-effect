import { Schema } from 'effect'

/** A declaration's source location: a repository-relative file and a 1-based line. */
export type Anchor = {
  readonly file: string
  readonly line: number
}

export const Anchor: Schema.Codec<Anchor> = Schema.Struct({
  file: Schema.String,
  line: Schema.Int.check(Schema.isGreaterThan(0)),
})

/** What the source says about who may rely on an item. */
const RELEASE_TAGS = ['public', 'beta', 'alpha', 'internal', 'untagged'] as const

export const ReleaseTag: Schema.Literals<typeof RELEASE_TAGS> = Schema.Literals(RELEASE_TAGS)
export type ReleaseTag = typeof ReleaseTag.Type

/** The facts every item carries about where it is declared and who may rely on it. */
export type ItemMeta = {
  readonly anchor: Anchor | null
  readonly releaseTag: ReleaseTag
  readonly stability: string | null
}

export const ItemMeta: Schema.Codec<ItemMeta> = Schema.Struct({
  anchor: Schema.NullOr(Anchor),
  releaseTag: ReleaseTag,
  stability: Schema.NullOr(Schema.String),
})

/** The anchor the model gives an item the source index could not map. */
export const NO_ITEM_META: ItemMeta = { anchor: null, releaseTag: 'untagged', stability: null }
