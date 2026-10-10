/**
 * The one serialiser every output goes through. Keys are ordered by UTF-16 code
 * unit, so the bytes never depend on the process locale, time zone or host.
 */

/** Orders strings by UTF-16 code unit, independent of any locale. */
export const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

const write = (value: unknown, indent: string): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`)
    return JSON.stringify(value)
  }
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((item: unknown) => inner + write(item, inner)).join(',\n')}\n${indent}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareCodeUnits)
    if (keys.length === 0) return '{}'
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${write(value[key], inner)}`).join(',\n')}\n${indent}}`
  }
  throw new TypeError(`canonicalJson: ${typeof value} is not JSON`)
}

/** Serialises a JSON value with sorted keys, two-space indentation and a trailing newline. */
export const canonicalJson = (value: unknown): string => `${write(value, '')}\n`

const writeCompact = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(writeCompact).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareCodeUnits)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${writeCompact(value[key])}`).join(',')}}`
  }
  return write(value, '')
}

/** The same ordering on one line: a structural identity key. */
export const canonicalKey = (value: unknown): string => writeCompact(value)
