const { resolve } = require('node:path');

const project = resolve(process.cwd(), 'tsconfig.json');

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'prettier',
    'turbo',
    require.resolve('@vercel/style-guide/eslint/node'),
    require.resolve('@vercel/style-guide/eslint/typescript'),
    'eslint-config-turbo',
  ],
  rules: {
    '@typescript-eslint/array-type': 'off',
    '@typescript-eslint/consistent-type-definitions': 'off',
    'import/no-extraneous-dependencies': 'off',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-misused-promises': [
      'error',
      {
        checksVoidReturn: {
          attributes: false,
        },
      },
    ],
    'import/order': 'off',
    'no-console': 'warn',
    '@typescript-eslint/no-dynamic-delete': 'off',
    /** no-undef is not useful for typescript already typescript checks and this rule will error on any global interface in any declaration file */
    'no-undef': 'off',
    'import/named': 'off',
    'import/no-default-export': 'off',
    'object-shorthand': 'error',
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'interface',
        format: ['PascalCase'],
        custom: {
          regex: '^I[A-Z]',
          match: true,
        },
      },
    ],
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  parser: '@typescript-eslint/parser',
  ignorePatterns: [
    '.*.js',
    '*.setup.js',
    '*.config.js',
    '.turbo/',
    'dist/',
    'coverage/',
    'node_modules/',
  ],
};
