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
    // The backend is frozen while the UI is rebuilt (docs/design/brief.md §5).
    // These type-aware rules mostly flag defensive guards such as
    // `const [row] = await db.select()…; if (!row)`, which the checker types
    // as always present because `noUncheckedIndexedAccess` is off. They stay
    // visible as warnings until the backend is open for a cleanup pass.
    files: [
      'src/server/**',
      'src/db/**',
      'src/adapters/**',
      'src/routes/api/**',
      'src/lib/session.server.ts',
      'scripts/seed.ts',
      'scripts/reset.ts',
    ],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/method-signature-style': 'warn',
    },
  },
  {
    // Generated paraglide output and build artefacts are not ours to lint.
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'src/paraglide/**',
      '.output/**',
    ],
  },
]
