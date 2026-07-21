import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Ratchet: 'warn' until the pino migration lands (obs plan Task 13
      // flips this to 'error'). Spec §8 DoD: no NEW bare console.* — new
      // warnings are review-blocking even while old ones burn down.
      'no-console': 'warn',
      // Pre-existing codebase style: Octokit payloads are cast via `any`
      // at the boundary (see server.ts). Not this initiative's fight.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
