/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['@ixo/eslint-config/nest.js'],
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/no-misused-promises': 'off',
  },
};
