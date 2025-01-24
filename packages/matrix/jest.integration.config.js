import config from '@ixo/jest-config/nest.js';

/** @type {import('jest').Config} */
export default {
  ...config,
  rootDir: '.',
  testMatch: ['<rootDir>/integration/**/*.test.ts'],
  testRegex: undefined,

  testTimeout: 60000,
  moduleDirectories: ['node_modules', 'src'],
  moduleNameMapper: {
    'src/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverage: false,
  coverageProvider: undefined,
};
