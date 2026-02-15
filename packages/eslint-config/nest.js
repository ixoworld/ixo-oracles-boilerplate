import jest from 'eslint-plugin-jest';
import { base } from './base.js';

/**
 * NestJS ESLint flat config. Extends base with NestJS-specific rules and Jest.
 */
export const nest = [
  ...base,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: [
      '**/__tests__/**/*.[jt]s?(x)',
      '**/?(*.)+(spec|test).[jt]s?(x)',
    ],
    ...jest.configs['flat/recommended'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/prefer-lowercase-title': 'off',
    },
  },
];

export default nest;
