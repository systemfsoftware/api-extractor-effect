import { Schema } from 'effect'

export const ExportTarget: Schema.Union<readonly [Schema.String, Schema.$Record<Schema.String, Schema.Codec<Schema.Json>>]> = Schema.Union([
  Schema.String,
  Schema.Record(Schema.String, Schema.Json),
])
export type ExportTarget = typeof ExportTarget.Type

type PackageManifestFields = {
  readonly name: Schema.String
  readonly version: Schema.String
  readonly exports: Schema.optionalKey<Schema.Union<readonly [Schema.String, Schema.$Record<Schema.String, typeof ExportTarget>]>>
}

export const PackageManifest: Schema.Struct<PackageManifestFields> = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  exports: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, ExportTarget)])),
})
export type PackageManifest = typeof PackageManifest.Type
