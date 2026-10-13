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
  })
