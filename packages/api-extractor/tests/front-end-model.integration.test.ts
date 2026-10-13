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

const itemNames = (model: Model, path: string): ReadonlyArray<string> => entryAt(model, path).items.map((item) => item.name)

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
      'a number spelled two ways by two emitters is one value',
      Gherkin.Do.pipe(
        Given('an entry emitted by oxc from `1_000` and `0x10`, and one spelled `1000` and `16` as tsc prints them')('declarations', () =>
          Effect.sync(() => {
            const emitted = isolatedDeclarationSync(
              'numbers.ts',
              'export enum E { B = 1_000 }\nexport const u = 1_000\nexport type T = 0x10\nexport type K = { 0x10: string }\n',
            )
            return declarations(
              [
                ['emitted.d.ts', emitted.code],
                ['printed.d.ts', 'export declare enum E { B = 1000 }\nexport declare const u = 1000;\nexport type T = 16;\nexport type K = { 16: string };\n'],
              ],
              [
                ['.', 'emitted.d.ts'],
                ['./printed', 'printed.d.ts'],
              ],
            )
          })),
        When('both are built')('model', (scope) => builtOf(scope.declarations)),
        Then('both entries hold the same items, each number written as its value')((scope, expect) =>
          expect({
            printed: entryAt(scope.model, './printed').items,
            E: itemOf(scope.model, '.', 'E', 'enum'),
            u: itemOf(scope.model, '.', 'u', 'variable'),
            T: itemOf(scope.model, '.', 'T', 'typeAlias'),
          }).toMatchObject({
            printed: entryAt(scope.model, '.').items,
            E: { members: [{ name: 'B', value: '1000' }] },
            u: { type: { kind: 'literal', text: '1000' } },
            T: { type: { kind: 'literal', text: '16' } },
          })),
      ),
    )

    scenario(
      'a negative number, a bigint, a boolean, null and a single-quoted string each model as the type its value spells',
      Gherkin.Do.pipe(
        Given('an entry declaring a value of each of `-1`, `10n`, `true`, `null` and `\'a\'`')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare const negative: -1\n' +
                  'export declare const big: 10n\n' +
                  'export declare const yes: true\n' +
                  'export declare const nothing: null\n' +
                  "export declare const single: 'a'\n",
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each value carries its own type, the string quoted as the compiler writes it')((scope, expect) =>
          expect({
            negative: itemOf(scope.model, '.', 'negative', 'variable'),
            big: itemOf(scope.model, '.', 'big', 'variable'),
            yes: itemOf(scope.model, '.', 'yes', 'variable'),
            nothing: itemOf(scope.model, '.', 'nothing', 'variable'),
            single: itemOf(scope.model, '.', 'single', 'variable'),
          }).toMatchObject({
            negative: { type: { kind: 'literal', text: '-1' } },
            big: { type: { kind: 'literal', text: '10n' } },
            yes: { type: { kind: 'literal', text: 'true' } },
            nothing: { type: { kind: 'keyword', name: 'null' } },
            single: { type: { kind: 'literal', text: '"a"' } },
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
      'an enum whose merged declarations repeat a member name is refused naming the repeated member',
      Gherkin.Do.pipe(
        Given('an entry declaring enum `E` with member `A` twice across two declarations')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare enum E { A = 1 }\nexport declare enum E { A = 2 }\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the repeated member')((scope, expect) =>
          expect({
            _tag: scope.refusal._tag,
            file: scope.refusal.file,
            construct: scope.refusal.construct,
          }).toEqual({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'enum member `A` declared twice' })),
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

    scenario(
      'locals whose names share a prefix keep their own names in a text type',
      Gherkin.Do.pipe(
        Given(
          'an entry exporting names that also name aliases it reaches from another file, one alias name a prefix of the other, each used in a mapped type',
        )('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { B as ShortB, BC, Id as ShortId, Ids, K as ShortK, Key, Opt as ShortOpt, Options } from './a.js'\n" +
                  'export type B = { readonly ownB: string }\n' +
                  'export type Id = { readonly ownId: string }\n' +
                  'export type K = { readonly ownK: string }\n' +
                  'export type Opt = { readonly ownOpt: string }\n' +
                  'export type S1 = { readonly [P in keyof ShortB]: BC }\n' +
                  'export type S2 = { readonly [P in keyof ShortId]: Ids }\n' +
                  'export type S3 = { readonly [P in keyof ShortK]: Key }\n' +
                  'export type S4 = { readonly [P in keyof ShortOpt]: Options }\n',
              ],
              [
                'a.d.ts',
                'export type B = { readonly b: string }\n' +
                  'export type BC = { readonly bc: string }\n' +
                  'export type Id = { readonly id: string }\n' +
                  'export type Ids = { readonly ids: string }\n' +
                  'export type K = { readonly k: string }\n' +
                  'export type Key = { readonly key: string }\n' +
                  'export type Opt = { readonly opt: string }\n' +
                  'export type Options = { readonly options: string }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('every mapped type names the whole local name, never part of another')((scope, expect) =>
          expect({
            S1: itemOf(scope.model, '.', 'S1', 'typeAlias'),
            S2: itemOf(scope.model, '.', 'S2', 'typeAlias'),
            S3: itemOf(scope.model, '.', 'S3', 'typeAlias'),
            S4: itemOf(scope.model, '.', 'S4', 'typeAlias'),
          }).toMatchObject({
            S1: { kind: 'typeAlias', type: { kind: 'text', text: '{ readonly [P in keyof B_2]: BC }' } },
            S2: { kind: 'typeAlias', type: { kind: 'text', text: '{ readonly [P in keyof Id_2]: Ids }' } },
            S3: { kind: 'typeAlias', type: { kind: 'text', text: '{ readonly [P in keyof K_2]: Key }' } },
            S4: { kind: 'typeAlias', type: { kind: 'text', text: '{ readonly [P in keyof Opt_2]: Options }' } },
          })),
      ),
    )

    scenario(
      'a named optional tuple member keeps its question mark',
      Gherkin.Do.pipe(
        Given('an entry declaring `[first: string, second?: number]`')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare type Pair = [first: string, second?: number]\n']]))),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the canonical text marks the optional member')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'Pair', 'typeAlias')).toMatchObject({
            kind: 'typeAlias',
            type: { kind: 'text', text: '[first: string, second?: number]' },
          })),
      ),
    )

    scenario(
      'an interface item keeps its type parameters, heritage and every member kind',
      Gherkin.Do.pipe(
        Given('an entry declaring an interface with a bounded default parameter, two extensions and property, method members')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export interface Collection<A extends string = "a"> extends Base<A>, Marker {\n' +
                  '  readonly size: number\n' +
                  '  count(): number\n' +
                  '  create(value: A): A\n' +
                  '}\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the interface item carries all of them')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'Collection', 'interface')).toMatchObject({
            kind: 'interface',
            name: 'Collection',
            typeParameters: [{ name: 'A', constraint: { kind: 'keyword', name: 'string' }, default: { kind: 'literal', text: '"a"' } }],
            extends: [
              { kind: 'reference', name: 'Base', args: [{ kind: 'reference', name: 'A', args: [] }] },
              { kind: 'reference', name: 'Marker', args: [] },
            ],
            members: [
              { kind: 'property', name: 'size', optional: false, readonly: true, type: { kind: 'keyword', name: 'number' } },
              { kind: 'method', name: 'count', optional: false, signatures: [{ typeParameters: [], parameters: [], returns: { kind: 'keyword', name: 'number' } }] },
              {
                kind: 'method',
                name: 'create',
                optional: false,
                signatures: [
                  {
                    typeParameters: [],
                    parameters: [{ name: 'value', type: { kind: 'reference', name: 'A', args: [] }, optional: false, rest: false }],
                    returns: { kind: 'reference', name: 'A', args: [] },
                  },
                ],
              },
            ],
          })),
      ),
    )

    scenario(
      'a class item keeps its abstractness, type parameters, heritage and every member kind',
      Gherkin.Do.pipe(
        Given('an entry declaring an abstract class extending a base, implementing a marker, with a property, a constructor, a getter and a method')(
          'declarations',
          () =>
            Effect.succeed(
              declarations([
                [
                  'index.d.ts',
                  'export declare abstract class Bag<A> extends Base<A> implements Marker {\n' +
                    '  readonly size: number\n' +
                    '  constructor(initial: A)\n' +
                    '  get first(): A\n' +
                    '  create(value: A): A\n' +
                    '}\n',
                ],
              ]),
            ),
        ),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the class item carries all of them')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'Bag', 'class')).toMatchObject({
            kind: 'class',
            name: 'Bag',
            abstract: true,
            typeParameters: [{ name: 'A' }],
            extends: [{ kind: 'reference', name: 'Base', args: [{ kind: 'reference', name: 'A', args: [] }] }],
            implements: [{ kind: 'reference', name: 'Marker', args: [] }],
            members: [
              { kind: 'property', name: 'size', optional: false, readonly: true, type: { kind: 'keyword', name: 'number' } },
              {
                kind: 'method',
                name: 'constructor',
                optional: false,
                signatures: [
                  {
                    typeParameters: [],
                    parameters: [{ name: 'initial', type: { kind: 'reference', name: 'A', args: [] }, optional: false, rest: false }],
                    returns: { kind: 'keyword', name: 'any' },
                  },
                ],
              },
              { kind: 'property', name: 'first', optional: false, readonly: true, type: { kind: 'reference', name: 'A', args: [] } },
              {
                kind: 'method',
                name: 'create',
                optional: false,
                signatures: [
                  {
                    typeParameters: [],
                    parameters: [{ name: 'value', type: { kind: 'reference', name: 'A', args: [] }, optional: false, rest: false }],
                    returns: { kind: 'reference', name: 'A', args: [] },
                  },
                ],
              },
            ],
          })),
      ),
    )

    scenario(
      'a global augmentation is refused naming the file and the construct',
      Gherkin.Do.pipe(
        Given('a declaration file augmenting the global scope')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare global {\n  interface Window { extra: string }\n}\nexport declare type T = string\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the global augmentation')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`declare global`' })),
      ),
    )

    scenario(
      'a module augmentation is refused naming the file and the named module',
      Gherkin.Do.pipe(
        Given('a declaration file augmenting another module')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare module "other" {\n  interface Thing { extra: string }\n}\nexport declare type T = string\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the module')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`declare module "other"`' })),
      ),
    )

    scenario(
      'a named re-export from another package is refused naming the file and the re-export',
      Gherkin.Do.pipe(
        Given('an entry re-exporting one name from another package')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', "export { X } from 'other-pkg'\n"]]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the re-export')((scope, expect) =>
          expect(scope.refusal).toMatchObject({
            _tag: 'UnsupportedDeclaration',
            file: 'index.d.ts',
            construct: 're-export of "X" from "other-pkg"',
          })),
      ),
    )

    scenario(
      'an untyped constant, a non-literal initialiser, an import by assignment, an exported namespace name, an expression default export, a destructuring constant, a destructuring parameter, a dotted namespace declaration, an unparseable declaration body and a bare import type are each refused naming the file and the construct',
      Gherkin.Do.pipe(
        Given('a file declaring `declare const x;`')('noType', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare const x;\n']]))),
        Given('a file whose exported constant is initialised by a call')('callInitialised', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare function f(): string\nexport declare const x = f()\n']]))),
        Given("a file importing by assignment with `import x = require('y')`")('importEquals', () =>
          Effect.succeed(declarations([['index.d.ts', "import x = require('y')\n"]]))),
        Given('a file exporting a namespace name with `export as namespace X`')('namespaceName', () =>
          Effect.succeed(declarations([['index.d.ts', 'export as namespace X\n']]))),
        Given('a file exporting an expression as its default with `export default 1 + 1`')('defaultExpression', () =>
          Effect.succeed(declarations([['index.d.ts', 'export default 1 + 1\n']]))),
        Given('a file exporting a destructuring constant with `export declare const { a }: { a: string }`')('destructured', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare const { a }: { a: string }\n']]))),
        Given('a file declaring a function with a destructuring parameter `{ a }: { a: string }`')('destructuringParam', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare function f({ a }: { a: string }): void\n']]))),
        Given('a file declaring a dotted namespace `A.B`')('dottedNamespace', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare namespace A.B { const x: number }\n']]))),
        Given('a file whose declaration body is malformed `export declare const = ;`')('unparseable', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare const = ;\n']]))),
        Given("a file whose constant type is the bare `typeof import('./x.js')`")('bareImportType', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "export declare const v: typeof import('./x.js')\n"],
              ['x.d.ts', 'export declare const inner: string\n'],
            ]),
          )),
        When('each declaration file is built')('refusals', (scope) =>
          Effect.all({
            noType: Effect.flip(FrontEnd.buildModel(scope.noType)),
            callInitialised: Effect.flip(FrontEnd.buildModel(scope.callInitialised)),
            importEquals: Effect.flip(FrontEnd.buildModel(scope.importEquals)),
            namespaceName: Effect.flip(FrontEnd.buildModel(scope.namespaceName)),
            defaultExpression: Effect.flip(FrontEnd.buildModel(scope.defaultExpression)),
            destructured: Effect.flip(FrontEnd.buildModel(scope.destructured)),
            destructuringParam: Effect.flip(FrontEnd.buildModel(scope.destructuringParam)),
            dottedNamespace: Effect.flip(FrontEnd.buildModel(scope.dottedNamespace)),
            unparseable: Effect.flip(FrontEnd.buildModel(scope.unparseable)),
            bareImportType: Effect.flip(FrontEnd.buildModel(scope.bareImportType)),
          })),
        Then('each refusal names the declaration file and the construct it cannot model')((scope, expect) =>
          expect(scope.refusals).toMatchObject({
            noType: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a variable declaration without a type' },
            callInitialised: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a variable initialiser that is not a literal' },
            importEquals: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`import =`' },
            namespaceName: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`export as namespace`' },
            defaultExpression: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`export default` of an expression' },
            destructured: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a destructuring variable declaration' },
            destructuringParam: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a destructuring parameter' },
            dottedNamespace: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a dotted namespace declaration' },
            unparseable: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: expect.stringMatching(/^unparseable declaration text/) },
            bareImportType: { _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a bare import type' },
          })),
      ),
    )

    scenario(
      'a set accessor models as a writable property and prints without a return type',
      Gherkin.Do.pipe(
        Given('an interface, a class and a mapped value each declaring `set value(input: string)`')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export interface Readout {\n  set value(input: string)\n}\n' +
                  'export declare class Meter {\n  set value(input: string)\n}\n' +
                  'export declare type Boxed = { [K in "a"]: { set value(input: string) } }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each accessor is a writable property and the printed one invents no return type')((scope, expect) =>
          expect({
            interface: itemOf(scope.model, '.', 'Readout', 'interface'),
            class: itemOf(scope.model, '.', 'Meter', 'class'),
            boxed: itemOf(scope.model, '.', 'Boxed', 'typeAlias'),
          }).toMatchObject({
            interface: {
              kind: 'interface',
              members: [{ kind: 'property', name: 'value', optional: false, readonly: false, type: { kind: 'keyword', name: 'string' } }],
            },
            class: {
              kind: 'class',
              members: [{ kind: 'property', name: 'value', optional: false, readonly: false, type: { kind: 'keyword', name: 'string' } }],
            },
            boxed: { kind: 'typeAlias', type: { kind: 'text', text: '{ [K in "a"]: { set value(input: string) } }' } },
          })),
      ),
    )

    scenario(
      'an unnamed default function models the same default item as a named one',
      Gherkin.Do.pipe(
        Given('one entry declaring a named default function and another declaring the same function unnamed')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['named.d.ts', 'export default function format(x: number): string;\n'],
                ['unnamed.d.ts', 'export default function(x: number): string;\n'],
              ],
              [
                ['.', 'named.d.ts'],
                ['./unnamed', 'unnamed.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the unnamed entry models the default function the named entry models')((scope, expect) =>
          expect({ unnamed: itemOf(scope.model, './unnamed', 'default', 'function') }).toEqual({
            unnamed: itemOf(scope.model, '.', 'default', 'function'),
          })),
      ),
    )

    scenario(
      'an unnamed default class models the same default item as a named one',
      Gherkin.Do.pipe(
        Given('one entry declaring a named default class and another declaring the same class unnamed')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['named.d.ts', 'export default class Widget {\n\tm(): void;\n}\n'],
                ['unnamed.d.ts', 'export default class {\n\tm(): void;\n}\n'],
              ],
              [
                ['.', 'named.d.ts'],
                ['./unnamed', 'unnamed.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the unnamed entry models the default class the named entry models')((scope, expect) =>
          expect({ unnamed: itemOf(scope.model, './unnamed', 'default', 'class') }).toEqual({
            unnamed: itemOf(scope.model, '.', 'default', 'class'),
          })),
      ),
    )

    scenario(
      'a module that lists its exports offers only the names it lists',
      Gherkin.Do.pipe(
        Given('an entry exporting one value under another name and an entry whose export list is empty')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['renamed.d.ts', 'declare const x: number\nexport { x as y }\n'],
                ['nothing.d.ts', 'declare const x: number\nexport {}\n'],
              ],
              [
                ['.', 'renamed.d.ts'],
                ['./nothing', 'nothing.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each entry offers exactly the names a consumer can import from it')((scope, expect) =>
          expect({ renamed: itemNames(scope.model, '.'), nothing: itemNames(scope.model, './nothing') }).toEqual({
            renamed: ['y'],
            nothing: [],
          })),
      ),
    )

    scenario(
      'a module that assigns its default export offers no other name',
      Gherkin.Do.pipe(
        Given('an entry assigning its default export to one of two declarations')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare const x: number\ndeclare const z: number\nexport default x\n']]))),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the entry offers the default name alone, bound to the assigned declaration')((scope, expect) =>
          expect({
            names: itemNames(scope.model, '.'),
            default: itemOf(scope.model, '.', 'default', 'variable'),
          }).toEqual({
            names: ['default'],
            default: { kind: 'variable', name: 'default', constant: true, type: { kind: 'keyword', name: 'number' } },
          })),
      ),
    )

    scenario(
      'a module that re-exports from another file offers only those names',
      Gherkin.Do.pipe(
        Given('three entries re-exporting everything, one name and everything as a namespace from another file')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['star.d.ts', "export * from './b.js'\ndeclare const x: number\n"],
                ['named.d.ts', "export { q } from './b.js'\ndeclare const x: number\n"],
                ['namespace.d.ts', "export * as ns from './b.js'\ndeclare const x: number\n"],
                ['b.d.ts', 'export declare const q: number\n'],
              ],
              [
                ['.', 'star.d.ts'],
                ['./named', 'named.d.ts'],
                ['./namespace', 'namespace.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each entry offers exactly the names a consumer can import from it')((scope, expect) =>
          expect({
            star: itemNames(scope.model, '.'),
            named: itemNames(scope.model, './named'),
            namespace: itemNames(scope.model, './namespace'),
          }).toEqual({ star: ['q'], named: ['q'], namespace: ['ns'] })),
      ),
    )

    scenario(
      'a module that exports by declaring keeps the declarations it does not export',
      Gherkin.Do.pipe(
        Given('an entry declaring a default class beside an unexported class and an entry exporting one declaration beside another')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['default.d.ts', 'export default class Widget {\n\tm(): void;\n}\ndeclare class Hidden {}\n'],
                ['declared.d.ts', 'export declare const y: number\ndeclare const z: number\n'],
              ],
              [
                ['.', 'default.d.ts'],
                ['./declared', 'declared.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each entry offers exactly the names a consumer can import from it')((scope, expect) =>
          expect({
            declared: itemNames(scope.model, '.'),
            exported: itemNames(scope.model, './declared'),
          }).toEqual({ declared: ['Hidden', 'default'], exported: ['y', 'z'] })),
      ),
    )

    scenario(
      'an interface with an index, a call and a construct signature keeps all three members',
      Gherkin.Do.pipe(
        Given('an entry declaring `interface Callable { [key: string]: number; <A>(self: A): A; new (x: string): Callable }`')(
          'declarations',
          () =>
            Effect.succeed(
              declarations([
                ['index.d.ts', 'export interface Callable {\n  [key: string]: number\n  <A>(self: A): A\n  new (x: string): Callable\n}\n'],
              ]),
            ),
        ),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the interface carries the index signature, the call signature and the construct signature as a `new` method')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'Callable', 'interface')).toMatchObject({
            kind: 'interface',
            name: 'Callable',
            members: [
              { kind: 'property', name: '[key: string]', optional: false, readonly: false, type: { kind: 'keyword', name: 'number' } },
              {
                kind: 'call',
                signature: {
                  typeParameters: [{ name: 'A' }],
                  parameters: [{ name: 'self', type: { kind: 'reference', name: 'A', args: [] }, optional: false, rest: false }],
                  returns: { kind: 'reference', name: 'A', args: [] },
                },
              },
              {
                kind: 'method',
                name: 'new',
                optional: false,
                signatures: [
                  {
                    typeParameters: [],
                    parameters: [{ name: 'x', type: { kind: 'keyword', name: 'string' }, optional: false, rest: false }],
                    returns: { kind: 'reference', name: 'Callable', args: [] },
                  },
                ],
              },
            ],
          })),
      ),
    )

    scenario(
      'a callback or constructable type nested in another type reads as the compiler writes it',
      Gherkin.Do.pipe(
        Given('an entry declaring a tuple of callback types beside a constructable type')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare const handlers: [cb: (x: number) => string, done?: () => void]\n' +
                  'export declare type Build = new (x: number) => object\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each callback reads as an arrow and the constructable type as a `new` arrow')((scope, expect) =>
          expect({
            handlers: itemOf(scope.model, '.', 'handlers', 'variable'),
            build: itemOf(scope.model, '.', 'Build', 'typeAlias'),
          }).toMatchObject({
            handlers: { type: { kind: 'text', text: '[cb: (x: number) => string, done?: () => void]' } },
            build: { type: { kind: 'text', text: 'new (x: number) => object' } },
          })),
      ),
    )

    scenario(
      'a local alias whose name contains dollar signs keeps its name where a text type names it',
      Gherkin.Do.pipe(
        Given('an entry whose text type names two aliases it reaches, their names containing dollar signs')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { T$$ as First, $$T as Second } from './a.js'\n" +
                  'export declare type M = { readonly [P in keyof First]: Second }\n',
              ],
              ['a.d.ts', 'export type T$$ = { readonly a: string }\nexport type $$T = { readonly b: number }\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the alias names inside the text are unchanged and match the locals')((scope, expect) =>
          expect({
            m: itemOf(scope.model, '.', 'M', 'typeAlias'),
            locals: entryAt(scope.model, '.').locals.map((local) => local.name),
          }).toMatchObject({
            m: { kind: 'typeAlias', type: { kind: 'text', text: '{ readonly [P in keyof T$$]: $$T }' } },
            locals: ['$$T', 'T$$'],
          })),
      ),
    )

    scenario(
      'a declaration a file keeps hidden is a reference of its own, not the exported name',
      Gherkin.Do.pipe(
        Given('an entry re-exporting an interface and three functions whose result types name hidden declarations, two of them sharing a name')(
          'declarations',
          () =>
            Effect.succeed(
              declarations([
                [
                  'index.d.ts',
                  "export { Item } from './item.js'\n" +
                    "export { make } from './make.js'\n" +
                    "export { a } from './a.js'\n" +
                    "export { b } from './b.js'\n",
                ],
                ['item.d.ts', 'export interface Item { readonly id: string }\n'],
                ['make.d.ts', 'interface Item { readonly other: number }\nexport declare function make(): Item\nexport {}\n'],
                ['a.d.ts', 'interface Opts { readonly a: string }\nexport declare function a(): Opts\nexport {}\n'],
                ['b.d.ts', 'interface Opts { readonly b: number }\nexport declare function b(): Opts\nexport {}\n'],
              ]),
            ),
        ),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each hidden declaration becomes its own reference, distinct from the exported name')((scope, expect) =>
          expect({
            exported: itemOf(scope.model, '.', 'Item', 'interface'),
            make: itemOf(scope.model, '.', 'make', 'function'),
            a: itemOf(scope.model, '.', 'a', 'function'),
            b: itemOf(scope.model, '.', 'b', 'function'),
          }).toMatchObject({
            exported: { kind: 'interface', name: 'Item' },
            make: { signatures: [{ returns: { kind: 'reference', name: 'Item_2', args: [] } }] },
            a: { signatures: [{ returns: { kind: 'reference', name: 'Opts', args: [] } }] },
            b: { signatures: [{ returns: { kind: 'reference', name: 'Opts_2', args: [] } }] },
          })),
      ),
    )

    scenario(
      'two files that re-export each other offer each other’s exports once',
      Gherkin.Do.pipe(
        Given('an entry whose file re-exports a file that re-exports it back, each file declaring one value')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['a.d.ts', "export * from './b.js'\nexport declare const a: string\n"],
                ['b.d.ts', "export * from './a.js'\nexport declare const b: number\n"],
              ],
              [['.', 'a.d.ts']],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the entry offers each file’s own value, once')((scope, expect) =>
          expect({
            names: itemNames(scope.model, '.'),
            a: itemOf(scope.model, '.', 'a', 'variable'),
            b: itemOf(scope.model, '.', 'b', 'variable'),
          }).toEqual({
            names: ['a', 'b'],
            a: { kind: 'variable', name: 'a', constant: true, type: { kind: 'keyword', name: 'string' } },
            b: { kind: 'variable', name: 'b', constant: true, type: { kind: 'keyword', name: 'number' } },
          })),
      ),
    )

    scenario(
      'a package with two entry points models each entry from its own file',
      Gherkin.Do.pipe(
        Given('a main entry and a `./util` entry, each declaring its own value')('declarations', () =>
          Effect.succeed(
            declarations(
              [
                ['index.d.ts', 'export declare const main: string\n'],
                ['util.d.ts', 'export declare const helper: number\n'],
              ],
              [
                ['./util', 'util.d.ts'],
                ['.', 'index.d.ts'],
              ],
            ),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the model lists both entries in path order, each with only its own value')((scope, expect) =>
          expect(scope.model.entryPoints.map((entry) => ({ path: entry.path, names: entry.items.map((item) => item.name) }))).toEqual([
            { path: '.', names: ['main'] },
            { path: './util', names: ['helper'] },
          ])),
      ),
    )

    scenario(
      'a namespace or enum declared twice is one item holding every member',
      Gherkin.Do.pipe(
        Given('an entry declaring namespace `N` twice and enum `E` twice, each declaration adding one member')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare namespace N { const a: number }\nexport declare namespace N { const b: string }\nexport declare enum E { A = 1 }\nexport declare enum E { B = 2 }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the namespace holds both values and the enum both members')((scope, expect) =>
          expect({ namespace: itemOf(scope.model, '.', 'N', 'namespace'), enumeration: itemOf(scope.model, '.', 'E', 'enum') }).toEqual({
            namespace: {
              kind: 'namespace',
              name: 'N',
              items: [
                { kind: 'variable', name: 'a', constant: true, type: { kind: 'keyword', name: 'number' } },
                { kind: 'variable', name: 'b', constant: true, type: { kind: 'keyword', name: 'string' } },
              ],
            },
            enumeration: { kind: 'enum', name: 'E', const: false, members: [{ name: 'A', value: '1' }, { name: 'B', value: '2' }] },
          })),
      ),
    )

    scenario(
      'a namespace or enum declared twice inside a namespace body is one item holding every member',
      Gherkin.Do.pipe(
        Given('an entry declaring `N` twice, each holding a `namespace M` and an `enum E` that adds one member')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare namespace N { namespace M { const a: number } }\n' +
                  'export declare namespace N { namespace M { const b: string } }\n' +
                  'export declare namespace N { enum E { A = 1 } }\n' +
                  'export declare namespace N { enum E { B = 2 } }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the namespace `N` holds one `M` with both values and one `E` with both members')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'N', 'namespace')).toEqual({
            kind: 'namespace',
            name: 'N',
            items: [
              { kind: 'enum', name: 'E', const: false, members: [{ name: 'A', value: '1' }, { name: 'B', value: '2' }] },
              {
                kind: 'namespace',
                name: 'M',
                items: [
                  { kind: 'variable', name: 'a', constant: true, type: { kind: 'keyword', name: 'number' } },
                  { kind: 'variable', name: 'b', constant: true, type: { kind: 'keyword', name: 'string' } },
                ],
              },
            ],
          })),
      ),
    )

    scenario(
      'a namespace exported from inside a namespace body is an item of it, merged when declared twice',
      Gherkin.Do.pipe(
        Given('an entry declaring `N` twice, each body exporting a `namespace M` that holds one value')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                'export declare namespace N { export namespace M { const a: number } }\n' +
                  'export declare namespace N { export namespace M { const b: string } }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('the namespace `N` holds one `M` with both values')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'N', 'namespace')).toEqual({
            kind: 'namespace',
            name: 'N',
            items: [
              {
                kind: 'namespace',
                name: 'M',
                items: [
                  { kind: 'variable', name: 'a', constant: true, type: { kind: 'keyword', name: 'number' } },
                  { kind: 'variable', name: 'b', constant: true, type: { kind: 'keyword', name: 'string' } },
                ],
              },
            ],
          })),
      ),
    )

    scenario(
      'a name declared in a namespace body refers to that declaration inside the body, not to an import of the same name',
      Gherkin.Do.pipe(
        Given('an entry importing `A` from `pkg` and declaring namespace `N` with its own `A` and a function `f` returning `A`')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { A } from 'pkg'\n" +
                  'export declare namespace N { interface A { y: number } function f(): A }\n' +
                  'export declare const g: A\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then("`N.f` returns the namespace's own `A`, while `g` keeps the imported one")((scope, expect) =>
          expect({ n: itemOf(scope.model, '.', 'N', 'namespace'), g: itemOf(scope.model, '.', 'g', 'variable') }).toEqual({
            n: {
              kind: 'namespace',
              name: 'N',
              items: [
                {
                  kind: 'interface',
                  name: 'A',
                  typeParameters: [],
                  extends: [],
                  members: [{ kind: 'property', name: 'y', optional: false, readonly: false, type: { kind: 'keyword', name: 'number' } }],
                },
                { kind: 'function', name: 'f', signatures: [{ typeParameters: [], parameters: [], returns: { kind: 'reference', name: 'A', args: [] } }] },
              ],
            },
            g: { kind: 'variable', name: 'g', constant: true, type: { kind: 'reference', name: 'A', module: 'pkg', args: [] } },
          })),
      ),
    )

    scenario(
      'an import alias inside a namespace body is refused, as it is at the top of a file',
      Gherkin.Do.pipe(
        Given('an entry whose namespace `N` writes `import X = M.Y`')('declarations', () =>
          Effect.succeed(
            declarations([['index.d.ts', 'export declare namespace N { import X = M.Y; const a: X }\ndeclare namespace M { type Y = string }\nexport {}\n']]),
          )),
        When('the model is built')('refusal', (scope) => Effect.flip(builtOf(scope.declarations))),
        Then('it is refused naming the file and `import =`')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`import =`' })),
      ),
    )

    scenario(
      'a type reached through a namespace the file keeps hidden reads as the file writes it',
      Gherkin.Do.pipe(
        Given('an entry exporting `X = C.Inner`, where namespace `C` is declared but not exported')('declarations', () =>
          Effect.succeed(
            declarations([['index.d.ts', 'declare namespace C { interface Inner { readonly a: string } }\nexport type X = C.Inner\nexport {}\n']]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('`X` refers to `C.Inner`')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'X', 'typeAlias')).toEqual({
            kind: 'typeAlias',
            name: 'X',
            typeParameters: [],
            type: { kind: 'reference', name: 'C.Inner', args: [] },
          })),
      ),
    )

    scenario(
      'an inferred name inside a conditional type reads as the name it binds, not the import or declaration it shadows',
      Gherkin.Do.pipe(
        Given(
          'an entry importing type `U` from another package, keeping an interface `V` to itself and re-exporting a different `V` from another file, with aliases `Elem<T>` and `Pick2<T>` binding `U` and `V` by `infer`',
        )('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { U } from 'pkg'\n" +
                  'interface V { readonly hidden: string }\n' +
                  'export type Elem<T> = T extends Array<infer U> ? U : never\n' +
                  'export type Pick2<T> = T extends Map<infer V, infer W> ? [V, W] : never\n' +
                  "export { V } from './v.js'\n",
              ],
              ['v.d.ts', 'export interface V { readonly exported: string }\n'],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('each alias reads with the names its conditional binds, untouched by the import or the hidden interface')((scope, expect) =>
          expect({
            elem: itemOf(scope.model, '.', 'Elem', 'typeAlias'),
            pick2: itemOf(scope.model, '.', 'Pick2', 'typeAlias'),
          }).toMatchObject({
            elem: { kind: 'typeAlias', type: { kind: 'text', text: 'T extends Array<infer U> ? U : never' } },
            pick2: { kind: 'typeAlias', type: { kind: 'text', text: 'T extends Map<infer V, infer W> ? [V, W] : never' } },
          })),
      ),
    )
  })
