import { ApiModel, FrontEnd } from '@systemfsoftware/api-extractor'
import { Array as Arr, Function, Option } from 'effect'

export type Model = ApiModel.ApiModel
export type EntryPoint = ApiModel.EntryPoint
export type Item = ApiModel.ApiItem

export type SourceFiles = ReadonlyArray<readonly [string, string]>

export const declarations = (files: SourceFiles, ...entryPoints: readonly [] | readonly [SourceFiles]): FrontEnd.Declarations => ({
  producer: 'fixture-emitter@0.0.0',
  package: { name: 'fixture', version: '1.0.0' },
  anchorBase: 'package',
  anchorPrefix: '',
  entryPoints: (entryPoints[0] ?? [['.', 'index.d.ts']] as const).map(([exportPath, declarationFile]) => ({
    exportPath,
    declarationFile,
    target: { key: exportPath, condition: null, path: declarationFile },
  })),
  files: files.map(([path, text]) => ({ path, text })),
  sources: [],
})

export const entryAt: {
  (model: Model, path: string): EntryPoint
  (path: string): (model: Model) => EntryPoint
} = Function.dual(2, (model: Model, path: string): EntryPoint =>
  Option.getOrThrow(Arr.findFirst(model.entryPoints, (entry) => entry.path === path)))

export const itemOf: {
  (model: Model, path: string, name: string, kind: Item['kind']): Item
  (path: string, name: string, kind: Item['kind']): (model: Model) => Item
} = Function.dual(4, (model: Model, path: string, name: string, kind: Item['kind']): Item =>
  Option.getOrThrow(Arr.findFirst(entryAt(model, path).items, (item) => item.name === name && item.kind === kind)))

export const itemsNamed: {
  (model: Model, path: string, name: string): ReadonlyArray<Item>
  (path: string, name: string): (model: Model) => ReadonlyArray<Item>
} = Function.dual(3, (model: Model, path: string, name: string): ReadonlyArray<Item> =>
  entryAt(model, path).items.filter((item) => item.name === name))

export const builtOf = (given: FrontEnd.Declarations) => FrontEnd.buildModel(given)
