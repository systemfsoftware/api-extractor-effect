import { quietBuild } from '@systemfsoftware/tsdown-config/quiet-build'
import { defineConfig } from 'tsdown'

type ExportEntry = string | Record<string, string | undefined>

const types = './dist/mod.d.ts'

const withTypes = (exports: Record<string, ExportEntry>): Record<string, ExportEntry> => {
  const entry = exports['.']
  if (typeof entry === 'string') return { ...exports, '.': { types, default: entry } }
  if (entry === undefined) return exports
  const { default: defaultEntry, types: _generated, ...conditions } = entry
  return { ...exports, '.': { ...conditions, types, ...(defaultEntry === undefined ? {} : { default: defaultEntry }) } }
}

export default defineConfig({
  ...quietBuild,
  entry: { mod: './src/mod.ts' },
  format: 'esm',
  dts: true,
  tsconfig: './tsconfig.build.json',
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  deps: { onlyBundle: false },
  define: { 'import.meta.vitest': 'undefined' },
  exports: {
    devExports: '@systemfsoftware/source',
    customExports: withTypes,
  },
})
