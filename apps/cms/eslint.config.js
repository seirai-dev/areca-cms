//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    // Generated paraglide output and build artefacts are not ours to lint.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'src/paraglide/**',
      'src/lib/cn-tables.gen.ts',
      '.output/**',
      // Standalone Node/k6 tooling is outside the application TS project.
      // CI checks its syntax and runs the offline benchmark tests separately.
      'benchmarks/**',
    ],
  },
]
