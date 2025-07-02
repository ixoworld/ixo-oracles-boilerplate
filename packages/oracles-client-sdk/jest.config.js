/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...(await import('@ixo/jest-config/base.js').then((m) => m.default || m)),
  rootDir: '.',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.json)
    // Example: '^@/components/(.*)$': '<rootDir>/src/components/$1',
  },
};
