import { Schema } from 'effect'

export type SourceEntryPoint = {
  readonly exportPath: string
  readonly sourceFile: string
}

export type PackageSource = {
  readonly name: string
  readonly version: string
  readonly packageRoot: string
  readonly workspaceRoot: string
  readonly tsconfigPath: string
  readonly entryPoints: ReadonlyArray<SourceEntryPoint>
}

export type DeclarationFile = {
  readonly path: string
  readonly text: string
}

export type Declarations = {
  readonly producer: string
  readonly package: { readonly name: string; readonly version: string }
  readonly entryPoints: ReadonlyArray<{ readonly exportPath: string; readonly declarationFile: string }>
  readonly files: ReadonlyArray<DeclarationFile>
}

export const Declarations: Schema.Codec<Declarations> = Schema.Struct({
  producer: Schema.String,
  package: Schema.Struct({ name: Schema.String, version: Schema.String }),
  entryPoints: Schema.Array(Schema.Struct({ exportPath: Schema.String, declarationFile: Schema.String })),
  files: Schema.Array(Schema.Struct({ path: Schema.String, text: Schema.String })),
})

const positiveInt: Schema.Codec<number> = Schema.Int.check(Schema.isGreaterThan(0))

export const Reported: Schema.TaggedStruct<'Reported', {
  readonly file: Schema.optionalKey<Schema.String>
  readonly code: typeof positiveInt
  readonly message: Schema.String
}> = Schema.TaggedStruct('Reported', {
  file: Schema.optionalKey(Schema.String),
  code: positiveInt,
  message: Schema.String,
})

export type Reported = typeof Reported.Type

export const Note: Schema.TaggedStruct<'Note', {
  readonly file: Schema.optionalKey<Schema.String>
  readonly message: Schema.String
}> = Schema.TaggedStruct('Note', {
  file: Schema.optionalKey(Schema.String),
  message: Schema.String,
})

export type Note = typeof Note.Type

export type Diagnostic = Reported | Note

export const Diagnostic: Schema.Codec<Diagnostic> = Schema.Union([Reported, Note])
