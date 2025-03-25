import baseConfig from '@ixo/jest-config/base.js';

/** @type {import('jest').Config} */
const config = {
  ...baseConfig,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.(js|ts)$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
};

export default config;
