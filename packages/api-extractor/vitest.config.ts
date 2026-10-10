import { inlineSchemaTests } from '@systemfsoftware/effect-schema-vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Writes codec and recursion laws for every exported schema into src/schema-laws.test.ts,
  // and materializes each declared recursionBudget.
  plugins: [inlineSchemaTests()],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
