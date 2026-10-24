import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { FrontEnd } from '@systemfsoftware/api-extractor'
import { Effect, Layer } from 'effect'
import { builtOf, declarations } from './__fixtures__/declarations.ts'

const Feature = makeFeature({ it })

Feature('Refusing declaration text the model cannot hold')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
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
      'a typeof naming a module namespace import is refused rather than printed with an empty name',
      Gherkin.Do.pipe(
        Given('an entry importing a module namespace and declaring `typeof ns`')('declarations', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "import * as ns from './impl.js'\nexport declare const api: typeof ns\n"],
              ['impl.d.ts', 'export declare const x: number\n'],
            ]),
          )),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the namespace type')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a module namespace type' })),
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
      'an export list naming a name with no declaration is refused naming the file and the export',
      Gherkin.Do.pipe(
        Given('an entry declaring `present` and exporting `{ present, Missing }`')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'declare const present: number\nexport { present, Missing }\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file and the unresolved export')((scope, expect) =>
          expect({
            _tag: scope.refusal._tag,
            file: scope.refusal.file,
            construct: scope.refusal.construct,
          }).toEqual({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`export { Missing }`, which names no declaration' })),
      ),
    )

    scenario(
      'an export list reached through a star export is refused naming the file holding the unresolved name',
      Gherkin.Do.pipe(
        Given('an entry star-exporting a file declaring `present` and exporting `{ present, Missing }`')('declarations', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "export * from './a.js'\n"],
              ['a.d.ts', 'declare const present: number\nexport { present, Missing }\n'],
            ]),
          )),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('the refusal names the file holding the unresolved export')((scope, expect) =>
          expect({
            _tag: scope.refusal._tag,
            file: scope.refusal.file,
            construct: scope.refusal.construct,
          }).toEqual({ _tag: 'UnsupportedDeclaration', file: 'a.d.ts', construct: '`export { Missing }`, which names no declaration' })),
      ),
    )

    scenario(
      'a re-export from another package reached through a star export is refused naming the file that re-exports it, past an earlier star target listing the name unresolved',
      Gherkin.Do.pipe(
        Given("an entry star-exporting a file holding `export { x } from 'lodash'`")('direct', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "export * from './a.js'\n"],
              ['a.d.ts', "export { x } from 'lodash'\n"],
            ]),
          )),
        Given("an entry star-exporting `a.d.ts`, which lists `x` with no declaration, then `b.d.ts`, holding `export { x } from 'lodash'`")('behindUnresolved', () =>
          Effect.succeed(
            declarations([
              ['index.d.ts', "export * from './a.js'\nexport * from './b.js'\n"],
              ['a.d.ts', 'declare const present: number\nexport { present, x }\n'],
              ['b.d.ts', "export { x } from 'lodash'\n"],
            ]),
          )),
        When('each model is built')('refusals', (scope) =>
          Effect.all({
            direct: Effect.flip(FrontEnd.buildModel(scope.direct)),
            behindUnresolved: Effect.flip(FrontEnd.buildModel(scope.behindUnresolved)),
          })),
        Then('each refusal names the file holding the re-export')((scope, expect) =>
          expect({
            direct: { _tag: scope.refusals.direct._tag, file: scope.refusals.direct.file, construct: scope.refusals.direct.construct },
            behindUnresolved: { _tag: scope.refusals.behindUnresolved._tag, file: scope.refusals.behindUnresolved.file, construct: scope.refusals.behindUnresolved.construct },
          }).toEqual({
            direct: { _tag: 'UnsupportedDeclaration', file: 'a.d.ts', construct: 're-export of "x" from "lodash"' },
            behindUnresolved: { _tag: 'UnsupportedDeclaration', file: 'b.d.ts', construct: 're-export of "x" from "lodash"' },
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
      'an exported import alias inside a namespace body is refused, as it is at the top of a file',
      Gherkin.Do.pipe(
        Given('an entry whose namespace `N` writes `export import X = M.Y`')('declarations', () =>
          Effect.succeed(
            declarations([['index.d.ts', 'export declare namespace N { export import X = M.Y; const a: X }\ndeclare namespace M { type Y = string }\nexport {}\n']]),
          )),
        When('the model is built')('refusal', (scope) => Effect.flip(builtOf(scope.declarations))),
        Then('it is refused naming the file and `import =`')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: '`import =`' })),
      ),
    )

    scenario(
      'a destructuring constant inside a namespace body is refused, as it is at the top of a file',
      Gherkin.Do.pipe(
        Given('an entry whose namespace `N` declares `const { a }: { a: number }`')('declarations', () =>
          Effect.succeed(declarations([['index.d.ts', 'export declare namespace N {\n  const { a }: { a: number }\n}\n']]))),
        When('the model is built')('refusal', (scope) => Effect.flip(FrontEnd.buildModel(scope.declarations))),
        Then('it is refused naming the file and the destructuring declaration')((scope, expect) =>
          expect(scope.refusal).toMatchObject({ _tag: 'UnsupportedDeclaration', file: 'index.d.ts', construct: 'a destructuring variable declaration' })),
      ),
    )
  })
