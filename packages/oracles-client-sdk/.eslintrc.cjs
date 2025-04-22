/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['@ixo/eslint-config/library.js'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
};
