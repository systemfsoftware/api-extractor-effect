import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Array as Arr, Effect, Layer, Option } from 'effect'
import { isolatedDeclarationSync } from 'oxc-transform'

type Model = ApiModel.ApiModel
type EntryPoint = ApiModel.EntryPoint
type Item = ApiModel.ApiItem

const Feature = makeFeature({ it })

const declarations = (
  files: ReadonlyArray<readonly [string, string]>,
  entryPoints: ReadonlyArray<readonly [string, string]> = [['.', 'index.d.ts']],
): FrontEnd.Declarations => ({
  producer: 'fixture-emitter@0.0.0',
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: entryPoints.map(([exportPath, declarationFile]) => ({ exportPath, declarationFile })),
  files: files.map(([path, text]) => ({ path, text })),
})

const entryAt = (model: Model, path: string): EntryPoint =>
  Option.getOrThrow(Arr.findFirst(model.entryPoints, (entry) => entry.path === path))

const itemOf = (model: Model, path: string, name: string, kind: Item['kind']): Item =>
  Option.getOrThrow(Arr.findFirst(entryAt(model, path).items, (item) => item.name === name && item.kind === kind))

const itemsNamed = (model: Model, path: string, name: string): ReadonlyArray<Item> =>
  entryAt(model, path).items.filter((item) => item.name === name)

const builtOf = (given: FrontEnd.Declarations) => FrontEnd.buildModel(given)

Feature('Building a package API model from its declaration text')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'the same external type written two ways is one reference',
      Gherkin.Do.pipe(
        Given('an entry declaring the same external generic two ways')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { Effect } from 'effect'\n" +
                  'export declare const viaImport: Effect.Effect<string>\n' +
                  'export declare const viaImportType: import("effect").Effect.Effect<string>\n',
              ],
            ]),
          )),
        When('the package model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('both exports carry one reference to that module')((scope, expect) =>
          expect({
            viaImport: itemOf(scope.model, '.', 'viaImport', 'variable'),
            viaImportType: itemOf(scope.model, '.', 'viaImportType', 'variable'),
          }).toMatchObject({
            viaImport: {
              kind: 'variable',
              constant: true,
              type: { kind: 'reference', name: 'Effect.Effect', module: 'effect', args: [{ kind: 'keyword', name: 'string' }] },
            },
            viaImportType: {
              kind: 'variable',
              constant: true,
              type: { kind: 'reference', name: 'Effect.Effect', module: 'effect', args: [{ kind: 'keyword', name: 'string' }] },
            },
          })),
      ),
    )

    scenario(
      'a mapped type printed by two emitters and by hand is one canonical text',
      Gherkin.Do.pipe(
        Given('an entry printed by an emitter and two hand-formatted entries of one mapped type')('declarations', () =>
          Effect.sync(() => {
            const emitted = isolatedDeclarationSync('mapped.ts', 'export type M = { readonly [K in "a" | "b"]?: string }\n')
            return declarations(
              [
                ['emitted.d.ts', emitted.code],
                ['spaced.d.ts', 'export declare type M = { readonly [K in "a" | "b"]?: string }\n'],
                ['tight.d.ts', 'export declare type M = {readonly[K in "a"|"b"]?:string}\n'],
              ],
              [
                ['.', 'emitted.d.ts'],
                ['./spaced', 'spaced.d.ts'],
                ['./tight', 'tight.d.ts'],
              ],
            )
          })),
        When('all three are built')('model', (scope) => builtOf(scope.declarations)),
        Then('every alias carries the same canonical text')((scope, expect) =>
          expect({
            emitted: itemOf(scope.model, '.', 'M', 'typeAlias'),
            spaced: itemOf(scope.model, './spaced', 'M', 'typeAlias'),
            tight: itemOf(scope.model, './tight', 'M', 'typeAlias'),
          }).toMatchObject({
            emitted: { type: { kind: 'text', text: '{ readonly [K in "a" | "b"]?: string }' } },
            spaced: { type: { kind: 'text', text: '{ readonly [K in "a" | "b"]?: string }' } },
            tight: { type: { kind: 'text', text: '{ readonly [K in "a" | "b"]?: string }' } },
          })),
      ),
    )

    scenario(
      'a file re-exported under a namespace becomes a namespace item',
      Gherkin.Do.pipe(
        Given('an entry re-exporting one of its files under a namespace')('declarations', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "export * as ns from './ns.js'\n"],
              ['ns.d.ts', 'export declare const inner: string\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the namespace item holds that file’s export')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'ns', 'namespace')).toMatchObject({
            kind: 'namespace',
            name: 'ns',
            items: [{ kind: 'variable', name: 'inner', constant: true, type: { kind: 'keyword', name: 'string' } }],
          })),
      ),
    )

    scenario(
      'overloads collapse into one function carrying every signature',
      Gherkin.Do.pipe(
        Given('an entry declaring one function twice')('declarations', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', 'export declare function pick(a: string): string\nexport declare function pick(a: number): number\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('one function item carries both signatures in order')((scope, expect) =>
          expect({
            count: itemsNamed(scope.model, '.', 'pick').length,
            pick: itemOf(scope.model, '.', 'pick', 'function'),
          }).toMatchObject({
            count: 1,
            pick: {
              kind: 'function',
              name: 'pick',
              signatures: [
                { parameters: [{ name: 'a', type: { kind: 'keyword', name: 'string' } }], returns: { kind: 'keyword', name: 'string' } },
                { parameters: [{ name: 'a', type: { kind: 'keyword', name: 'number' } }], returns: { kind: 'keyword', name: 'number' } },
              ],
            },
          })),
      ),
    )

    scenario(
      'an alias an export reaches but the entry does not export lands in locals',
      Gherkin.Do.pipe(
        Given('an entry whose exported value names an alias it does not export')('declarations', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "import type { Hidden } from './hidden.js'\nexport declare const value: Hidden\n"],
              ['hidden.d.ts', 'export type Hidden = { readonly a: string }\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the alias is a local beside the export')((scope, expect) =>
          expect(entryAt(scope.model, '.')).toMatchObject({
            items: [{ kind: 'variable', name: 'value', type: { kind: 'reference', name: 'Hidden', args: [] } }],
            locals: [
              {
                kind: 'typeAlias',
                name: 'Hidden',
                typeParameters: [],
                type: {
                  kind: 'object',
                  members: [{ kind: 'property', name: 'a', optional: false, readonly: true, type: { kind: 'keyword', name: 'string' } }],
                },
              },
            ],
          })),
      ),
    )

    scenario(
      'two reachable aliases of one name are renamed and their references follow',
      Gherkin.Do.pipe(
        Given('an entry reaching two distinct aliases sharing a name')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { Shared as SharedA } from './a.js'\n" +
                  "import type { Shared as SharedB } from './b.js'\n" +
                  'export declare const pair: readonly [SharedA, SharedB]\n',
              ],
              ['a.d.ts', 'export type Shared = { readonly a: string }\n'],
              ['b.d.ts', 'export type Shared = { readonly b: number }\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the locals are suffixed in file order and the references follow')((scope, expect) =>
          expect({
            locals: entryAt(scope.model, '.').locals.map((local) => local.name),
            pair: itemOf(scope.model, '.', 'pair', 'variable'),
          }).toMatchObject({
            locals: ['Shared', 'Shared_2'],
            pair: {
              type: {
                kind: 'tuple',
                readonly: true,
                elements: [
                  { kind: 'reference', name: 'Shared', args: [] },
                  { kind: 'reference', name: 'Shared_2', args: [] },
                ],
              },
            },
          })),
      ),
    )

    scenario(
      'an assignment export is refused naming the declaration file',
      Gherkin.Do.pipe(
        Given('an entry exporting by assignment')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare const value: string\nexport = value\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the declaration file')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts' })),
      ),
    )

    scenario(
      'an enum member whose declared value is computed is refused naming the member, not silently left without a value',
      Gherkin.Do.pipe(
        Given('a declaration file declaring `enum Flags { Read = 1, Write = 1 << 1 }`')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare enum Flags {\n  Read = 1,\n  Write = 1 << 1\n}\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the member')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'enum member `Write` with a computed value' })),
      ),
    )

    scenario(
      'a built model decodes as schema version two',
      Gherkin.Do.pipe(
        Given('an entry with literals, an enum and a namespace')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare const answer: 42\n' +
                  'export declare const version = "1.0.0"\n' +
                  'export declare const enum Mode { On = "on", Off = "off" }\n' +
                  "export * as ns from './ns.js'\n",
              ],
              ['ns.d.ts', 'export declare function inner(): void\n'],
            ]),
          )),
        When('the model is built and encoded')('roundTrip', (scope) =>
          Effect.map(FrontEnd.buildModel(scope.declarations), (model) => ({ model, decoded: ApiModel.decode(ApiModel.encode(model)) }))),
        Then('decoding the bytes restores schema version two')((scope, expect) =>
          expect({
            built: scope.roundTrip.model.schemaVersion,
            decoded: scope.roundTrip.decoded.schemaVersion,
            namespaces: entryAt(scope.roundTrip.decoded, '.').items
              .filter((item) => item.kind === 'namespace')
              .map((item) => item.name),
            version: itemOf(scope.roundTrip.decoded, '.', 'version', 'variable'),
            mode: itemOf(scope.roundTrip.decoded, '.', 'Mode', 'enum'),
          }).toMatchObject({
            built: 2,
            decoded: 2,
            namespaces: ['ns'],
            version: { constant: true, type: { kind: 'literal', text: '"1.0.0"' } },
            mode: { kind: 'enum', const: true, members: [{ name: 'On', value: '"on"' }, { name: 'Off', value: '"off"' }] },
          })),
      ),
    )
  })
