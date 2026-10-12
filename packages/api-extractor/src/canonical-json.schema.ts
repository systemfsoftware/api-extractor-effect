/**
 * The one serialiser every output goes through. Keys are ordered by UTF-16 code
 * unit (`Order.String`), so the bytes never depend on the process locale, time
 * zone or host.
 */
import { Match, Order, Predicate, Schema } from 'effect'

/** A JSON value: what every output is serialised from. */
export const Json: typeof Schema.Json = Schema.Json
export type Json = Schema.Json

type Entry = readonly [string, Json]

const byKey: Order.Order<Entry> = Order.mapInput(Order.String, ([key]: Entry) => key)

const isJsonArray = (value: Json): value is Schema.JsonArray => Array.isArray(value)

const isJsonObject = (value: Json): value is Schema.JsonObject => Predicate.isObject(value) && !isJsonArray(value)

/** The members of an object, ordered by key code unit. */
const entriesOf = (value: Schema.JsonObject): ReadonlyArray<Entry> => Object.entries(value).sort(byKey)

const writeNumber = (value: number): string => {
  if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`)
  return JSON.stringify(value)
}

const writeArray = (items: Schema.JsonArray, indent: string): string => {
  const inner = `${indent}  `
  return items.length === 0 ? '[]' : `[\n${items.map((item) => inner + write(item, inner)).join(',\n')}\n${indent}]`
}

const writeObject = (value: Schema.JsonObject, indent: string): string => {
  const inner = `${indent}  `
  const entries = entriesOf(value)
  return entries.length === 0
    ? '{}'
    : `{\n${entries.map(([key, member]) => `${inner}${JSON.stringify(key)}: ${write(member, inner)}`).join(',\n')}\n${indent}}`
}

const write = (value: Json, indent: string): string =>
  Match.value(value).pipe(
    Match.when(Match.number, writeNumber),
    Match.when(isJsonArray, (items) => writeArray(items, indent)),
    Match.when(isJsonObject, (object) => writeObject(object, indent)),
    Match.orElse((scalar) => JSON.stringify(scalar)),
  )

/** Serialises a JSON value with sorted keys, two-space indentation and a trailing newline. */
export const canonicalJson = (value: Json): string => `${write(value, '')}\n`

const writeCompact = (value: Json): string =>
  Match.value(value).pipe(
    Match.when(isJsonArray, (items) => `[${items.map(writeCompact).join(',')}]`),
    Match.when(isJsonObject, (object) =>
      `{${entriesOf(object).map(([key, member]) => `${JSON.stringify(key)}:${writeCompact(member)}`).join(',')}}`),
    Match.orElse((scalar) => write(scalar, '')),
  )

/** The same ordering on one line: a structural identity key. */
export const canonicalKey = (value: Json): string => writeCompact(value)
