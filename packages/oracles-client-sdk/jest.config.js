const baseConfig = require('@ixo/jest-config/base');

/** @type {import('jest').Config} */
const config = {
  ...baseConfig,
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  coveragePathIgnorePatterns: [
    ...(baseConfig.coveragePathIgnorePatterns || []),
    'node_modules',
    'src/types',
    'src/mocks',
    'jest.setup.js',
  ],
};

module.exports = config;
