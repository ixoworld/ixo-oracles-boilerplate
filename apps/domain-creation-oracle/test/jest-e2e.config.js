/** @type {import('jest').Config} */
module.exports = {
  ...require('@ixo/jest-config/nest'),
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
