import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ApiModel, Verdict } from '@systemfsoftware/api-extractor'
import { Array as Arr, Effect, Layer, Option, Result } from 'effect'
import { decodeVerdict, effect, empty, functionItem, ref, signature, union, withEntryPoints, withExport } from './__fixtures__/surfaces.ts'

type Model = ApiModel.ApiModel
type Item = ApiModel.ApiItem

const Feature = makeFeature({ it })

const before = withExport(empty, functionItem(signature([], effect(ref('User'), ref('NotFound')))))
const after = withExport(empty, functionItem(signature([], effect(ref('User'), union([ref('NotFound'), ref('Timeout')])))))

const entry: ApiModel.EntryPoint = { path: '.', items: [], locals: [] }
const entryRepeated: Model = withEntryPoints(empty, [entry, entry])
const enumOf = (...names: ReadonlyArray<string>): Item => ({ kind: 'enum', name: 'Mode', const: false, members: names.map((name) => ({ name })) })
const enumRepeated = withExport(empty, enumOf('On', 'On'))
const enumDistinct = withExport(empty, enumOf('On', 'Off'))

const repeatedKeys: ReadonlyArray<{ readonly label: string; readonly repeated: Model; readonly distinct: Model }> = [
  { label: 'an entry-point path', repeated: entryRepeated, distinct: empty },
  { label: 'an enum member name', repeated: enumRepeated, distinct: enumDistinct },
]

const first: Verdict.Rule = Option.getOrThrow(Arr.get(Verdict.defaultCorpus.rules, 0))
const ambiguous: Verdict.RuleCorpus = {
  ...Verdict.defaultCorpus,
  rules: [...Verdict.defaultCorpus.rules, { ...first, rule_id: `${first.rule_id}-copy` }],
}
const sharedMatch = [first.match.kind, first.match.position ?? '*', first.match.channel ?? '*', first.match.direction ?? '*'].join('|')

Feature('The verdict cell judges two surfaces and refuses the ones it cannot')
  .withLayer(Layer.empty)
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'a widened error channel produces a canonical verdict document',
      Gherkin.Do.pipe(
        Given('two surfaces whose returned error channel gains a tag')('surfaces', () => Effect.sync(() => ({ before, after }))),
        When('the verdict cell judges them')('document', (scope) => Verdict.cell.run(scope.surfaces)),
        Then('the document is canonical JSON naming the widened error')((scope, expect) =>
          expect({
            terminated: scope.document.endsWith('}\n'),
            body: Result.getOrThrow(decodeVerdict(scope.document)),
          }).toMatchObject({
            terminated: true,
            body: {
              _tag: 'Verdict',
              bump: 'major',
              findings: [{ reason_code: 'E_WIDENED', locations: ['.:target/signature[0]/returns/E'] }],
            },
          }),
        ),
      ),
    )

    scenarioOutline(
      'a surface repeating <label> is refused while the distinct one is judged',
      repeatedKeys,
      (row) =>
        Gherkin.Do.pipe(
          Given('a surface repeating a key and one keeping it distinct')('row', () => Effect.sync(() => row)),
          When('the verdict cell judges each in turn')('outcome', (scope) =>
            Effect.flatMap(Effect.flip(Verdict.cell.run({ before: scope.row.repeated, after })), (repeated) =>
              Effect.map(Verdict.cell.run({ before: scope.row.distinct, after }), (document) => ({
                repeated,
                distinct: Result.getOrThrow(decodeVerdict(document)),
              })),
            ),
          ),
          Then('the repeated surface is refused and the distinct one is judged')((scope, expect) =>
            expect(scope.outcome).toMatchObject({ repeated: { _tag: 'SurfaceRejected' }, distinct: { _tag: 'Verdict' } }),
          ),
        ),
    )

    scenario(
      'a corpus whose rules tie on one change is refused naming the shared match',
      Gherkin.Do.pipe(
        Given('a corpus carrying a second rule matching the first')('surfaces', () => Effect.sync(() => ({ before, after }))),
        When('the verdict cell judges the surfaces against it')('refusal', (scope) =>
          Effect.flip(Verdict.cell.run({ before: scope.surfaces.before, after: scope.surfaces.after, corpus: ambiguous })),
        ),
        Then('the corpus is refused naming the tie')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'RuleCorpusRejected', ambiguities: [`two rules match ${sharedMatch}`] }),
        ),
      ),
    )
  })
