import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer } from 'effect'
import { builtOf, declarations, itemOf } from './__fixtures__/declarations.ts'

const Feature = makeFeature({ it })

Feature('Building the namespaces of a package API model')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
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
      'a typeof query and a class heritage read the names a namespace body declares as values',
      Gherkin.Do.pipe(
        Given('an entry importing `A` and `B` from `pkg`, with `N` declaring a value `A`, an interface `B`, `typeof A`, `typeof B` and a class extending `A`')(
          'declarations',
          () =>
            Effect.succeed(declarations([[
              'index.d.ts',
              "import { A, B } from 'pkg'\nexport declare namespace N {\n  const A: new () => object\n  interface B { b: string }\n  type OfA = typeof A\n  type OfB = typeof B\n  class C extends A {}\n}\n",
            ]])),
        ),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then("`typeof A` and `C`'s base read `N`'s value `A`, while `typeof B` reads the imported value `B`")((scope, expect) =>
          expect(itemOf(scope.model, '.', 'N', 'namespace')).toMatchObject({
            items: expect.arrayContaining([
              { kind: 'typeAlias', name: 'OfA', typeParameters: [], type: { kind: 'text', text: 'typeof A' } },
              { kind: 'typeAlias', name: 'OfB', typeParameters: [], type: { kind: 'text', text: 'typeof import("pkg").B' } },
              expect.objectContaining({ kind: 'class', name: 'C', extends: [{ kind: 'reference', name: 'A', args: [] }] }),
            ]),
          })),
      ),
    )

    scenario(
      "a class or enum one block of a merged namespace declares is read in both spaces from the other block",
      Gherkin.Do.pipe(
        Given('an entry importing `C` and `E` from `pkg`, declaring `N` once with a class `C` and an enum `E`, and again with types naming `C`, `typeof C`, `E` and `typeof E`')(
          'declarations',
          () =>
            Effect.succeed(declarations([[
              'index.d.ts',
              "import { C, E } from 'pkg'\nexport declare namespace N {\n  class C {}\n  enum E { A = 1 }\n}\nexport declare namespace N {\n  type OfC = C\n  type QueryC = typeof C\n  type OfE = E\n  type QueryE = typeof E\n}\n",
            ]])),
        ),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then("every reference reads `N`'s own `C` and `E`, none the imports")((scope, expect) =>
          expect(itemOf(scope.model, '.', 'N', 'namespace')).toMatchObject({
            items: expect.arrayContaining([
              { kind: 'typeAlias', name: 'OfC', typeParameters: [], type: { kind: 'reference', name: 'C', args: [] } },
              { kind: 'typeAlias', name: 'QueryC', typeParameters: [], type: { kind: 'text', text: 'typeof C' } },
              { kind: 'typeAlias', name: 'OfE', typeParameters: [], type: { kind: 'reference', name: 'E', args: [] } },
              { kind: 'typeAlias', name: 'QueryE', typeParameters: [], type: { kind: 'text', text: 'typeof E' } },
            ]),
          })),
      ),
    )

    scenario(
      'a namespace body value does not shadow an imported type of the same name',
      Gherkin.Do.pipe(
        Given('an entry importing type `A` from `pkg` and declaring namespace `N` with a value `A` and a function `f` returning `A`')('declarations', () =>
          Effect.succeed(
            declarations([
              [
                'index.d.ts',
                "import type { A } from 'pkg'\n" +
                  'export declare namespace N { const A: number; function f(): A }\n',
              ],
            ]),
          )),
        When('the model is built')('model', (scope) => builtOf(scope.declarations)),
        Then('`N.f` returns the imported `A`, while the value stays a value')((scope, expect) =>
          expect(itemOf(scope.model, '.', 'N', 'namespace')).toEqual({
            kind: 'namespace',
            name: 'N',
            items: [
              { kind: 'variable', name: 'A', constant: true, type: { kind: 'keyword', name: 'number' } },
              {
                kind: 'function',
                name: 'f',
                signatures: [
                  { typeParameters: [], parameters: [], returns: { kind: 'reference', name: 'A', module: 'pkg', args: [] } },
                ],
              },
            ],
          })),
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
  })
