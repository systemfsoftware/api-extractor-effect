import { Schema } from 'effect'
import { AnchorBase, type EntryPointTarget, type PackageSurface } from '../model/api-model.schema.ts'

/** One entry of the package's `exports` map, reduced to the target consumers resolve. */
export type SourceEntryPoint = {
  readonly exportPath: string
  /** The package-relative source path, without a `./` prefix. */
  readonly sourceFile: string
  /** The manifest key that produced this entry: an explicit key or the pattern key it matched. */
  readonly key: string
  /** The condition that selected the target, or null for a bare path. */
  readonly condition: string | null
  /** The manifest target as written, e.g. `./src/mod.ts`. */
  readonly target: string
}

export type PackageSource = {
  readonly name: string
  readonly version: string
  readonly packageRoot: string
  readonly workspaceRoot: string
  readonly tsconfigPath: string
  /** Where anchors are rooted: `workspace` when a workspace root exists above the package. */
  readonly anchorBase: AnchorBase
  /** The package's path from the anchor root, joined with `/`; empty at the package root. */
  readonly anchorPrefix: string
  /** The package's `exports` and `imports` maps, reduced to their resolved targets. */
  readonly manifest: PackageSurface
  /** Pattern export keys that resolved a target but no source file. */
  readonly patternEmpties: ReadonlyArray<string>
  readonly entryPoints: ReadonlyArray<SourceEntryPoint>
}

export type DeclarationFile = {
  readonly path: string
  readonly text: string
}

/** A source text the emitter read, kept so the source index never re-reads the filesystem. */
export type SourceFile = {
  readonly path: string
  readonly text: string
}

export type Declarations = {
  readonly producer: string
  readonly package: { readonly name: string; readonly version: string }
  /** Where the source index roots anchors: the workspace root, or the package root. */
  readonly anchorBase: AnchorBase
  /** The package's path from the anchor root, joined with `/`; empty at the root. */
  readonly anchorPrefix: string
  readonly entryPoints: ReadonlyArray<{ readonly exportPath: string; readonly declarationFile: string; readonly target?: EntryPointTarget }>
  readonly files: ReadonlyArray<DeclarationFile>
  readonly sources: ReadonlyArray<SourceFile>
}

const TextFile = Schema.Struct({ path: Schema.String, text: Schema.String })

export const Declarations: Schema.Codec<Declarations> = Schema.Struct({
  producer: Schema.String,
  package: Schema.Struct({ name: Schema.String, version: Schema.String }),
  anchorBase: AnchorBase,
  anchorPrefix: Schema.String,
  entryPoints: Schema.Array(
    Schema.Struct({
      exportPath: Schema.String,
      declarationFile: Schema.String,
      target: Schema.optionalKey(
        Schema.Struct({ key: Schema.String, condition: Schema.NullOr(Schema.String), path: Schema.String }),
      ),
    }),
  ),
  files: Schema.Array(TextFile),
  sources: Schema.Array(TextFile),
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
