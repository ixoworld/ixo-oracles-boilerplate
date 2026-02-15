import { base } from './base.js';

/**
 * Library ESLint flat config. Extends base with relaxed rules for shared libraries.
 */
export const library = [
  ...base,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];

export default library;
