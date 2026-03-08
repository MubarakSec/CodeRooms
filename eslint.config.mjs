import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'out-server/**',
      'coverage/**',
      '.coverage-v8/**'
    ]
  },
  {
    files: ['src/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-restricted-imports': ['error', {
        patterns: [
          'out/**',
          'out-server/**',
          '../out/**',
          '../out-server/**'
        ]
      }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }]
    }
  }
];
