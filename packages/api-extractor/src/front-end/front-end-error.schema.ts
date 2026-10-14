import { type Cause, Match, Schema } from 'effect'
import { Diagnostic, type Note, type Reported } from './declarations.schema.ts'

type DiagnosticsFields = { readonly diagnostics: Schema.$Array<typeof Diagnostic> }

const diagnosticsFields: DiagnosticsFields = { diagnostics: Schema.Array(Diagnostic) }

const fileLabel = (file: string | undefined): string => (file === undefined ? '' : `${file}: `)

const reportedLine = ({ file, code, message }: Reported): string => `${fileLabel(file)}TS${code} ${message}`

const noteLine = ({ file, message }: Note): string => `${fileLabel(file)}${message}`

const listedLine: (diagnostic: Diagnostic) => string = Match.type<Diagnostic>().pipe(
  Match.tag('Reported', reportedLine),
  Match.tag('Note', noteLine),
  Match.exhaustive,
)

const listed = (diagnostics: ReadonlyArray<Diagnostic>): string => diagnostics.map(listedLine).join('\n')

const NoSourceEntryBase: Schema.Class<NoSourceEntry, Schema.TaggedStruct<'NoSourceEntry', { readonly packageRoot: Schema.String }>, Cause.YieldableError> =
  Schema.TaggedError<NoSourceEntry>()('NoSourceEntry', { packageRoot: Schema.String })

export class NoSourceEntry extends NoSourceEntryBase {
  override get message(): string {
    return `${this.packageRoot}: no export resolves to a TypeScript source through its source condition`
  }
}

type ManifestRejectedFields = { readonly packageRoot: Schema.String; readonly issue: Schema.String }

const ManifestRejectedBase: Schema.Class<ManifestRejected, Schema.TaggedStruct<'ManifestRejected', ManifestRejectedFields>, Cause.YieldableError> =
  Schema.TaggedError<ManifestRejected>()('ManifestRejected', { packageRoot: Schema.String, issue: Schema.String })

export class ManifestRejected extends ManifestRejectedBase {
  override get message(): string {
    return `${this.packageRoot}: the package manifest could not be read: ${this.issue}`
  }
}

const NotIsolatedBase: Schema.Class<NotIsolated, Schema.TaggedStruct<'NotIsolated', DiagnosticsFields>, Cause.YieldableError> =
  Schema.TaggedError<NotIsolated>()('NotIsolated', diagnosticsFields)

export class NotIsolated extends NotIsolatedBase {
  override get message(): string {
    return `declarations need the type checker:\n${listed(this.diagnostics)}`
  }
}

const CompilerRejectedBase: Schema.Class<CompilerRejected, Schema.TaggedStruct<'CompilerRejected', DiagnosticsFields>, Cause.YieldableError> =
  Schema.TaggedError<CompilerRejected>()('CompilerRejected', diagnosticsFields)

export class CompilerRejected extends CompilerRejectedBase {
  override get message(): string {
    return `the compiler refused the package:\n${listed(this.diagnostics)}`
  }
}

type UnsupportedDeclarationFields = { readonly file: Schema.String; readonly construct: Schema.String }

const UnsupportedDeclarationBase: Schema.Class<UnsupportedDeclaration, Schema.TaggedStruct<'UnsupportedDeclaration', UnsupportedDeclarationFields>, Cause.YieldableError> =
  Schema.TaggedError<UnsupportedDeclaration>()('UnsupportedDeclaration', { file: Schema.String, construct: Schema.String })

export class UnsupportedDeclaration extends UnsupportedDeclarationBase {
  override get message(): string {
    return `${this.file}: ${this.construct} is not supported`
  }
}
