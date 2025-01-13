/** @type {import('jest').Config} */
module.exports = {
  ...require('@ixo/jest-config/nest'),
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
};
