/** @type {import('jest').Config} */
module.exports = {
  ...require('./base'),
  rootDir: 'src',
  testRegex: '.*\\.(spec|test)\\.ts$',
  transform: {
    '^.+\\.(t)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
