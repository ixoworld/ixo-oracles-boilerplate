import { defineConfig } from '@ixo/vitest-config/base';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.e2e-spec.ts'],
    root: '.',
  },
});
