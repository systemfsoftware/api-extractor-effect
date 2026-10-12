/// <reference types="vitest/importMeta" />
import { Array as Arr, Match, Option, Schema, SchemaGetter } from 'effect'
import type { Diagnostic } from './declarations.schema.ts'

const EMITTED_PREFIX = 'TSFILE: '
const ERROR_PREFIX = 'error TS'
const CODE_SEPARATOR = ': '
const TAIL_HEAD = '): error TS'
const EMITTED_PREFIX_LENGTH = EMITTED_PREFIX.length
const POSITION_DIGITS = '(?:0|[1-9][0-9]{0,8})'
const POSITION_LIMIT = 1_000_000_000
const FILED_LINE = new RegExp(`^([\\s\\S]*)\\((${POSITION_DIGITS}),(${POSITION_DIGITS})\\): error TS(${POSITION_DIGITS}): ([\\s\\S]*)$`)

type EmittedFileFields = { readonly file: string }

type SourcelessDiagnosticFields = { readonly code: number; readonly message: string }

type FiledDiagnosticFields = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly code: number
  readonly message: string
}

const Digits: Schema.String = Schema.String.check(Schema.isPattern(new RegExp(`^${POSITION_DIGITS}$`)))

const FileText: Schema.String = Schema.String.check(Schema.isPattern(/^[^\n\r\u2028\u2029]+$/))

const MessageText: Schema.String = Schema.String.check(
  Schema.isPattern(/^(?![\s\S]*\(\d{1,9},\d{1,9}\): error TS\d{1,9}: )[\s\S]*$/),
)

const Position: Schema.Int = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(POSITION_LIMIT))

const EmittedFileFields: Schema.Struct<{ readonly file: typeof FileText }> = Schema.Struct({ file: FileText })

const SourcelessDiagnosticFields: Schema.Struct<{ readonly code: typeof Position; readonly message: Schema.String }> = Schema.Struct({
  code: Position,
  message: Schema.String,
})

const FiledDiagnosticFields: Schema.Struct<{
  readonly file: typeof FileText
  readonly line: typeof Position
  readonly column: typeof Position
  readonly code: typeof Position
  readonly message: typeof MessageText
}> = Schema.Struct({ file: FileText, line: Position, column: Position, code: Position, message: MessageText })

const emittedFileOf = (line: string): EmittedFileFields => ({ file: line.slice(EMITTED_PREFIX_LENGTH) })

const emittedLineOf = (fields: EmittedFileFields): `TSFILE: ${string}` => `${EMITTED_PREFIX}${fields.file}`

const sourcelessDiagnosticOf = (line: string): SourcelessDiagnosticFields => {
  const separator = line.indexOf(CODE_SEPARATOR, ERROR_PREFIX.length)
  return { code: Number(line.slice(ERROR_PREFIX.length, separator)), message: line.slice(separator + CODE_SEPARATOR.length) }
}

const sourcelessLineOf = (fields: SourcelessDiagnosticFields): `error TS${string}: ${string}` =>
  `${ERROR_PREFIX}${fields.code}${CODE_SEPARATOR}${fields.message}`

const UNPARSED_FILED_LINE: FiledDiagnosticFields = { file: '', line: -1, column: -1, code: -1, message: '' }

const partOf = (parts: RegExpExecArray) => (index: number): string => parts[index] ?? ''

const numberPartOf = (parts: RegExpExecArray) => (index: number): number => Number(parts[index] ?? '')

const filedFieldsFrom = (parts: RegExpExecArray): FiledDiagnosticFields => ({
  file: partOf(parts)(1),
  line: numberPartOf(parts)(2),
  column: numberPartOf(parts)(3),
  code: numberPartOf(parts)(4),
  message: partOf(parts)(5),
})

const filedDiagnosticOf = (line: string): FiledDiagnosticFields =>
  Option.match(Option.fromNullishOr(FILED_LINE.exec(line)), { onNone: () => UNPARSED_FILED_LINE, onSome: filedFieldsFrom })

const filedLineOf = (fields: FiledDiagnosticFields): `${string}(${number},${number}): error TS${number}: ${string}` =>
  `${fields.file}(${fields.line},${fields.column}${TAIL_HEAD}${fields.code}${CODE_SEPARATOR}${fields.message}`

export const EmittedFileLine: Schema.Codec<EmittedFileFields, string> = Schema.TemplateLiteral([EMITTED_PREFIX, FileText]).pipe(
  Schema.decodeTo(EmittedFileFields, { decode: SchemaGetter.transform(emittedFileOf), encode: SchemaGetter.transform(emittedLineOf) }),
)

export const SourcelessDiagnosticLine: Schema.Codec<SourcelessDiagnosticFields, string> = Schema.TemplateLiteral([
  ERROR_PREFIX,
  Digits,
  CODE_SEPARATOR,
  Schema.String,
]).pipe(
  Schema.decodeTo(SourcelessDiagnosticFields, {
    decode: SchemaGetter.transform(sourcelessDiagnosticOf),
    encode: SchemaGetter.transform(sourcelessLineOf),
  }),
)

export const FiledDiagnosticLine: Schema.Codec<FiledDiagnosticFields, string> = Schema.TemplateLiteral([
  FileText,
  '(',
  Digits,
  ',',
  Digits,
  TAIL_HEAD,
  Digits,
  CODE_SEPARATOR,
  MessageText,
]).pipe(
  Schema.decodeTo(FiledDiagnosticFields, {
    decode: SchemaGetter.transform(filedDiagnosticOf),
    encode: SchemaGetter.transform(filedLineOf),
  }),
)

const decodeEmittedFileLine: (line: string) => Option.Option<EmittedFileFields> = Schema.decodeOption(EmittedFileLine)

const decodeSourcelessDiagnosticLine: (line: string) => Option.Option<SourcelessDiagnosticFields> = Schema.decodeOption(SourcelessDiagnosticLine)

const decodeFiledDiagnosticLine: (line: string) => Option.Option<FiledDiagnosticFields> = Schema.decodeOption(FiledDiagnosticLine)

type ParsedLine =
  | { readonly kind: 'emittedFile'; readonly file: string }
  | { readonly kind: 'diagnostic'; readonly diagnostic: Diagnostic }

export type CompilerOutput = {
  readonly emittedFiles: ReadonlyArray<string>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

export type CompilerOutputRequest = {
  readonly stdout: string
  readonly packageRoot: string
}

const posixOf = (value: string): string => value.replace(/\\/g, '/')

const withTrailingSeparator = (value: string): string => `${value.replace(/\/+$/, '')}/`

const packageRelativeFile = (packageRoot: string, file: string): string => {
  const root = withTrailingSeparator(posixOf(packageRoot))
  const normalised = posixOf(file)
  return normalised.startsWith(root) ? normalised.slice(root.length) : normalised
}

const emittedFileOfLine = (line: string): Option.Option<ParsedLine> =>
  Option.map(decodeEmittedFileLine(line), (fields) => ({ kind: 'emittedFile', file: fields.file }))

const sourcelessDiagnosticOfLine = (line: string): Option.Option<ParsedLine> =>
  Option.map(decodeSourcelessDiagnosticLine(line), (fields) => ({
    kind: 'diagnostic',
    diagnostic: { file: '', code: fields.code, message: fields.message },
  }))

const filedDiagnosticOfLine = (packageRoot: string) => (line: string): Option.Option<ParsedLine> =>
  Option.map(decodeFiledDiagnosticLine(line), (fields): ParsedLine => ({
    kind: 'diagnostic',
    diagnostic: { file: packageRelativeFile(packageRoot, fields.file), code: fields.code, message: fields.message },
  }))

const parsedLineOf = (packageRoot: string) => (line: string): Option.Option<ParsedLine> =>
  Option.orElse(emittedFileOfLine(line), () =>
    Option.orElse(sourcelessDiagnosticOfLine(line), () => filedDiagnosticOfLine(packageRoot)(line)))

const emittedFileIn = (parsed: ParsedLine): Option.Option<string> =>
  Match.value(parsed).pipe(
    Match.when({ kind: 'emittedFile' }, (line) => Option.some(line.file)),
    Match.orElse(() => Option.none()),
  )

const diagnosticIn = (parsed: ParsedLine): Option.Option<Diagnostic> =>
  Match.value(parsed).pipe(
    Match.when({ kind: 'diagnostic' }, (line) => Option.some(line.diagnostic)),
    Match.orElse(() => Option.none()),
  )

const linesOf = (stdout: string): ReadonlyArray<string> => stdout.split('\n').map((line) => line.replace(/\r$/, ''))

export const parseCompilerOutput: (request: CompilerOutputRequest) => CompilerOutput = (request) => {
  const parsed = Arr.getSomes(linesOf(request.stdout).map(parsedLineOf(request.packageRoot)))
  return { emittedFiles: Arr.getSomes(parsed.map(emittedFileIn)), diagnostics: Arr.getSomes(parsed.map(diagnosticIn)) }
}

const NINE_DIGIT_SEEDS: ReadonlyArray<number> = [-1, 0, 999_999_999, 1_000_000_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5]

const SPELLING_SEEDS: ReadonlyArray<string> = ['', '0', '00', '007', '7', '999999999', '1000000000', '0999999999', '-1']

const nonNegativeSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

const printableByTsc = (value: number): boolean => nonNegativeSafeInteger(value) && String(value).length <= 9

const spellsItsValue = (text: string): boolean => String(Number(text)) === text

const canonicalSpelling = (text: string): boolean => spellsItsValue(text) && printableByTsc(Number(text))

const isSourcelessDiagnostic: (input: unknown) => input is SourcelessDiagnosticFields = Schema.is(SourcelessDiagnosticFields)

const codeAccepted = (code: number): boolean => isSourcelessDiagnostic({ code, message: 'm' })

const codeTextDecodes = (text: string): boolean => Option.isSome(decodeSourcelessDiagnosticLine(`${ERROR_PREFIX}${text}${CODE_SEPARATOR}m`))

const paddedSpelling = (padding: number, value: number): string => `${'0'.repeat(Math.abs(padding) % 3)}${value}`

if (import.meta.vitest !== void 0) {
  // The test runner only exists under vitest; tsdown defines import.meta.vitest as undefined and drops this block.
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀n_SourcelessDiagnosticFieldsPositionRefusal_≡PrintableByTsc',
    { of: [Schema.Finite], subject: codeAccepted },
    (subject, [value]) => Arr.every(Arr.append(NINE_DIGIT_SEEDS, value), (code) => subject(code) === printableByTsc(code)),
  )

  it.prop(
    '∀s_SourcelessDiagnosticLineDigitsRefusal_≡CanonicalSpelling',
    { of: [Schema.Int, Schema.Int], subject: codeTextDecodes },
    (subject, [padding, value]) =>
      Arr.every(Arr.append(SPELLING_SEEDS, paddedSpelling(padding, value)), (text) => subject(text) === canonicalSpelling(text)),
  )
}
