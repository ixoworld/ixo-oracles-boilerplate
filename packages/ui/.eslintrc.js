/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@ixo/eslint-config/react-internal.js'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.lint.json',
    tsconfigRootDir: __dirname,
  },
};
