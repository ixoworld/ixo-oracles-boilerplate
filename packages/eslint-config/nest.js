const { resolve } = require('node:path');

const project = resolve(process.cwd(), 'tsconfig.json');

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['./base.js'],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-extraneous-class': 'warn',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
      extends: [require.resolve('@vercel/style-guide/eslint/jest')],
      rules: {
        'jest/prefer-lowercase-title': 'off',
      },
    },
  ],
  env: {
    node: true,
    jest: true,
  },
};
