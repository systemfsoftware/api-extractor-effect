import { NodeServices } from '@effect/platform-node'
import { FrontEnd } from '@systemfsoftware/api-extractor'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer, Path } from 'effect'
import { declarationsOf, upstreamPairs } from './__fixtures__/upstream-messages.ts'

const Feature = makeFeature({ it })

const emitters = FrontEnd.isolatedEmitterLayer.pipe(Layer.provideMerge(NodeServices.layer))

const packageRoot = Effect.flatMap(Path.Path, (path) => Effect.map(path.fromFileUrl(new URL('..', import.meta.url)), (root) => path.resolve(root)))

type Row = readonly [string, string, string]

const rowKey = (row: Row): string => row.join('\u0000')

const sorted = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> =>
  rows
    .filter((row, index) => rows.findIndex((candidate) => rowKey(candidate) === rowKey(row)) === index)
    .sort((left, right) => (rowKey(left) < rowKey(right) ? -1 : 1))

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const entryFileOf = (declarations: FrontEnd.Declarations, exportPath: string): string => {
  const entry = declarations.entryPoints.find((candidate) => candidate.exportPath === exportPath)
  return entry === undefined ? '' : baseName(entry.declarationFile)
}

const entryPointOf = (declarations: FrontEnd.Declarations, message: FrontEnd.AnalysisMessage): string =>
  message.messageId === 'ae-forgotten-export' ? entryFileOf(declarations, message.entryPoint) : ''

const asRows = (declarations: FrontEnd.Declarations, messages: ReadonlyArray<FrontEnd.AnalysisMessage>): ReadonlyArray<Row> =>
  messages.map((message) => [message.messageId, message.symbol, entryPointOf(declarations, message)] as const)

const bothSides = (declarations: FrontEnd.Declarations) =>
  Effect.map(FrontEnd.resolveMessages(declarations), (messages) => ({ declarations, messages, upstream: upstreamPairs(declarations) }))

const reviewed = (declarations: FrontEnd.Declarations, messages: ReadonlyArray<FrontEnd.AnalysisMessage>): ReadonlyArray<Row> =>
  sorted(asRows(declarations, messages))

const forgottenAt = (messages: ReadonlyArray<FrontEnd.AnalysisMessage>): ReadonlyArray<FrontEnd.AnalysisMessage> =>
  messages.filter((message) => message.messageId === 'ae-forgotten-export')

const entry = (lines: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> => [['index.d.ts', lines.join('\n')]]

const SOME_NOTE = 'the notes are derived here and api-extractor derives them from the same declarations'

Feature('Review notes for a package match the ones api-extractor derives')
  .withLayer(emitters)
  .live('it reads the package from disk and runs api-extractor over declarations written to a real temporary directory')
  .body(({ scenario }) => {
    scenario(
      'A function returning a type the entry does not export is noted as a forgotten export',
      Gherkin.Do.pipe(
        Given('a package whose exported function returns a type the entry does not export')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: [
                [
                  'index.d.ts',
                  [
                    "import type { Schema } from 'effect'",
                    "import type { Widget } from './widget.ts'",
                    'export declare function makeWidget(input: Schema.Json): Widget',
                    '',
                  ].join('\n'),
                ],
                ['widget.d.ts', 'export interface Widget { readonly name: string }\n'],
              ],
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('the forgotten export names the type at the function name and the external type draws no note')((scope, expect) =>
          expect({ pairs: reviewed(scope.both.declarations, scope.both.messages), forgotten: forgottenAt(scope.both.messages) }).toEqual({
            pairs: sorted(scope.both.upstream),
            forgotten: [{ messageId: 'ae-forgotten-export', entryPoint: '.', item: 'makeWidget', symbol: 'Widget' }],
          })),
      ),
    )

    scenario(
      'An exported value with no release tag is noted as untagged',
      Gherkin.Do.pipe(
        Given('a package exporting a value with no release tag')('declarations', () =>
          Effect.sync(() => declarationsOf({ entry: 'index.d.ts', files: entry(['export declare const value: string']) }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the exported value as untagged')((scope, expect) => expect(reviewed(scope.both.declarations, scope.both.messages)).toEqual(sorted(scope.both.upstream))),
      ),
    )

    scenario(
      'An internal value whose name lacks an underscore is noted',
      Gherkin.Do.pipe(
        Given('a package exporting an internal value whose name lacks an underscore')('declarations', () =>
          Effect.sync(() => declarationsOf({ entry: 'index.d.ts', files: entry(['/** @internal */', 'export declare const secret: string']) }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the value should carry an underscore')((scope, expect) => expect(reviewed(scope.both.declarations, scope.both.messages)).toEqual(sorted(scope.both.upstream))),
      ),
    )

    scenario(
      "A release tag belongs to its own declaration, not to the one after it",
      Gherkin.Do.pipe(
        Given('a package where a tagged value and an interface member\'s doc comment precede untagged values')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: entry([
                '/** @internal */',
                'export declare const _hidden: string',
                'export declare const shown: string',
                'export interface I {',
                '  /** @beta */',
                '  readonly x: string',
                '}',
                'export declare const after: string',
              ]),
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the untagged values as untagged')((scope, expect) =>
          expect({
            notes: reviewed(scope.both.declarations, scope.both.messages),
            shownUntaggedUpstream: sorted(scope.both.upstream).some(([id, symbol]) => id === 'ae-missing-release-tag' && symbol === 'shown'),
          }).toEqual({ notes: sorted(scope.both.upstream), shownUntaggedUpstream: true })),
      ),
    )

    scenario(
      'A public function using a beta type is noted as incompatible',
      Gherkin.Do.pipe(
        Given('a package whose public function uses a beta type')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: entry(['/** @beta */', 'export interface B { readonly x: string }', '/** @public */', 'export declare function f(): B']),
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the incompatible release tags')((scope, expect) => expect(reviewed(scope.both.declarations, scope.both.messages)).toEqual(sorted(scope.both.upstream))),
      ),
    )

    scenario(
      'A class merged with an internal namespace is noted as mixed',
      Gherkin.Do.pipe(
        Given('a package with a public class merged with an internal namespace')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: entry(['/** @public */', 'export declare class C { }', '/** @internal */', 'export declare namespace C { }']),
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the mixed release tags')((scope, expect) => expect(reviewed(scope.both.declarations, scope.both.messages)).toEqual(sorted(scope.both.upstream))),
      ),
    )

    scenario(
      'A generic declaration does not hide a forgotten export of the same name',
      Gherkin.Do.pipe(
        Given('a package where a generic function and an imported type share a name but only the function binds it')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: [
                [
                  'index.d.ts',
                  [
                    "import type { A } from './inner.ts'",
                    'export declare function wrap<A>(a: A): A',
                    'export declare function use(a: A): A',
                    '',
                  ].join('\n'),
                ],
                ['inner.d.ts', 'export interface A { readonly x: string }\n'],
              ],
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note the imported type as a forgotten export of the function that uses it')((scope, expect) =>
          expect({
            notes: reviewed(scope.both.declarations, scope.both.messages),
            forgotten: forgottenAt(scope.both.messages),
          }).toEqual({
            notes: sorted(scope.both.upstream),
            forgotten: [{ messageId: 'ae-forgotten-export', entryPoint: '.', item: 'use', symbol: 'A' }],
          })),
      ),
    )

    scenario(
      'A mapped-type key or an inferred type variable does not stand for a declaration of the same name',
      Gherkin.Do.pipe(
        Given('a package whose mapped type and conditional type bind K and U while an exported function uses imported types K and U')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: [
                [
                  'index.d.ts',
                  [
                    "import type { K, U } from './inner.ts'",
                    '/** @public */',
                    "export declare const keyed: { [K in 'a' | 'b']: K }",
                    '/** @public */',
                    'export type Unwrap<T> = T extends Promise<infer U> ? U : never',
                    '/** @public */',
                    'export declare function use(k: K, u: U): void',
                    '',
                  ].join('\n'),
                ],
                ['inner.d.ts', 'export interface K { readonly k: string }\nexport interface U { readonly u: string }\n'],
              ],
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('both note K and U as forgotten exports of the function only')((scope, expect) =>
          expect({
            notes: reviewed(scope.both.declarations, scope.both.messages),
            forgotten: forgottenAt(scope.both.messages),
          }).toEqual({
            notes: sorted(scope.both.upstream),
            forgotten: [
              { messageId: 'ae-forgotten-export', entryPoint: '.', item: 'use', symbol: 'K' },
              { messageId: 'ae-forgotten-export', entryPoint: '.', item: 'use', symbol: 'U' },
            ],
          })),
      ),
    )

    scenario(
      'A package that repeats one note reports it once, in code-unit order',
      Gherkin.Do.pipe(
        Given('a package whose exported function names one non-exported type twice beside an internal export without an underscore')('declarations', () =>
          Effect.sync(() =>
            declarationsOf({
              entry: 'index.d.ts',
              files: [
                [
                  'index.d.ts',
                  [
                    "import type { Missing } from './missing.ts'",
                    '/** @internal */',
                    'export declare const secret: string',
                    'export declare function f(a: Missing, b: Missing): void',
                    '',
                  ].join('\n'),
                ],
                ['missing.d.ts', 'export interface Missing { readonly x: string }\n'],
              ],
            }))),
        When(SOME_NOTE)('both', (scope) => bothSides(scope.declarations)),
        Then('the full list of notes is sorted and de-duplicated and matches upstream')((scope, expect) =>
          expect({
            notes: scope.both.messages,
            pairs: reviewed(scope.both.declarations, scope.both.messages),
          }).toEqual({
            notes: [
              { messageId: 'ae-forgotten-export', entryPoint: '.', item: 'f', symbol: 'Missing' },
              { messageId: 'ae-internal-missing-underscore', entryPoint: '.', item: 'secret', symbol: 'secret' },
              { messageId: 'ae-missing-release-tag', entryPoint: '.', item: 'f', symbol: 'f' },
            ],
            pairs: sorted(scope.both.upstream),
          })),
      ),
    )

    scenario(
      'Every note for this package matches the ones api-extractor derives for it',
      Gherkin.Do.pipe(
        Given('this repository package')('source', () => Effect.flatMap(packageRoot, (root) => FrontEnd.readPackage({ packageRoot: root }))),
        When('its declarations are derived here and api-extractor reviews the same declarations')('both', (scope) =>
          Effect.gen(function* () {
            const isolated = yield* FrontEnd.IsolatedEmitter
            return yield* bothSides(yield* isolated.emit(scope.source))
          })),
        Then('every note matches')((scope, expect) => expect(reviewed(scope.both.declarations, scope.both.messages)).toEqual(sorted(scope.both.upstream))),
      ),
    )
  })
