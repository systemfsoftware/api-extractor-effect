/**
 * The TSDoc facts both the source index and the message resolver read: the release
 * tag, Effect's `@stability` annotation, and the comment that leads a declaration.
 */
import {
  type DocComment,
  DocParagraph,
  DocPlainText,
  type DocNode,
  type StandardModifierTagSet,
  TSDocConfiguration,
  TSDocParser,
  TSDocTagDefinition,
  TSDocTagSyntaxKind,
} from '@microsoft/tsdoc'
import { Array as Arr, Function as Fn, Match, Option, Predicate } from 'effect'

/** The release tags TSDoc names. `untagged` is the model's default, not a TSDoc tag. */
export type TSDocReleaseTag = 'internal' | 'alpha' | 'beta' | 'public'

export type DocFacts = {
  readonly releaseTag: Option.Option<TSDocReleaseTag>
  readonly stability: Option.Option<string>
}

const STABILITY_TAG = '@stability'

const parserConfiguration: TSDocConfiguration = new TSDocConfiguration()
parserConfiguration.addTagDefinitions([
  new TSDocTagDefinition({ tagName: STABILITY_TAG, syntaxKind: TSDocTagSyntaxKind.BlockTag }),
])

const parser: TSDocParser = new TSDocParser(parserConfiguration)

const docCommentText = (comment: string): string => `/*${comment}*/`

const parsedComment = (comment: string): DocComment => parser.parseString(docCommentText(comment)).docComment

const releaseTagIn = (tags: StandardModifierTagSet): Option.Option<TSDocReleaseTag> =>
  Match.value(tags).pipe(
    Match.when((candidate) => candidate.isPublic(), () => Option.some<TSDocReleaseTag>('public')),
    Match.when((candidate) => candidate.isBeta(), () => Option.some<TSDocReleaseTag>('beta')),
    Match.when((candidate) => candidate.isAlpha(), () => Option.some<TSDocReleaseTag>('alpha')),
    Match.when((candidate) => candidate.isInternal(), () => Option.some<TSDocReleaseTag>('internal')),
    Match.orElse(() => Option.none<TSDocReleaseTag>()),
  )

const plainTextOf = (node: DocNode): ReadonlyArray<string> =>
  node instanceof DocPlainText ? [node.text] : []

const paragraphTextOf = (node: DocNode): ReadonlyArray<string> =>
  node instanceof DocParagraph ? [Arr.flatMap(node.getChildNodes(), plainTextOf).join('').trim()] : []

const stabilityOf = (comment: DocComment): Option.Option<string> =>
  Option.flatMap(
    Arr.findFirst(comment.customBlocks, (block) => block.blockTag.tagName === STABILITY_TAG),
    (block) =>
      Option.filter(
        Option.some(Arr.flatMap(block.content.nodes, paragraphTextOf).join('').trim()),
        (text) => text.length > 0,
      ),
  )

/** The release tag and `@stability` value a doc comment declares, if any. */
export const docFactsOf = (comment: string): DocFacts => {
  const parsed = parsedComment(comment)
  return {
    releaseTag: releaseTagIn(parsed.modifierTagSet),
    stability: stabilityOf(parsed),
  }
}

export type SourceComment = {
  readonly type: string
  readonly value: string
}

export type SourceDocComment = SourceComment & {
  readonly start: number
  readonly end: number
}

export const isDocComment = (comment: SourceComment): boolean =>
  comment.type === 'Block' && comment.value.startsWith('*')

/** The end of the last sibling statement that finishes before `at`; comments start after it. */
export const precedingEnd: {
  (statements: ReadonlyArray<{ readonly end: number }>, at: number): number
  (at: number): (statements: ReadonlyArray<{ readonly end: number }>) => number
} = Fn.dual(2, (statements: ReadonlyArray<{ readonly end: number }>, at: number): number =>
  Arr.reduce(statements, 0, (end, statement) => (statement.end <= at ? Math.max(end, statement.end) : end)))

const startsAtOrAfter = (floor: number) => (comment: SourceDocComment): boolean => comment.start >= floor

const endsAtOrBefore = (at: number) => (comment: SourceDocComment): boolean => comment.end <= at

/** The doc comment that leads the statement starting at `at`, after the sibling at `floor`. */
export const leadingDocComment: {
  (comments: ReadonlyArray<SourceDocComment>, floor: number, at: number): Option.Option<SourceDocComment>
  (floor: number, at: number): (comments: ReadonlyArray<SourceDocComment>) => Option.Option<SourceDocComment>
} = Fn.dual(3, (comments: ReadonlyArray<SourceDocComment>, floor: number, at: number): Option.Option<SourceDocComment> =>
  Arr.findLast(comments, Predicate.and(isDocComment, Predicate.and(startsAtOrAfter(floor), endsAtOrBefore(at)))))
