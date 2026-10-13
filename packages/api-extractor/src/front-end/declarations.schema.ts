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

export type Diagnostic = {
  readonly file?: string
  readonly code?: number
  readonly message: string
}

export const Diagnostic: Schema.Codec<Diagnostic> = Schema.Struct({
  file: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  message: Schema.String,
})
