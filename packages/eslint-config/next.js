const { resolve } = require('node:path');

const project = resolve(process.cwd(), 'tsconfig.json');

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['./base.js', require.resolve('@vercel/style-guide/eslint/next')],
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    node: true,
    browser: true,
  },
  plugins: ['only-warn'],
  settings: {
    'import/resolver': {
      typescript: {
        project,
      },
    },
  },
  overrides: [
    {
      files: ['*.js?(x)', '*.ts?(x)'],
      rules: {
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          {
            allowAny: false,
            allowNullish: false,
            allowNever: false,
            allowBoolean: true,
            allowNumber: true,
            allowRegExp: true,
          },
        ],
        'unicorn/prefer-node-protocol': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
};
