const nestConfig = require('@ixo/jest-config/nest');

/** @type {import('jest').Config} */
module.exports = {
  ...nestConfig,
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
