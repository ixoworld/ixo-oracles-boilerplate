import { mergeConfig } from '@ixo/vitest-config/base';
import config from '@ixo/vitest-config/nest';

export default mergeConfig(config, {
  test: {
    exclude: ['**/authz.test.ts', 'node_modules', 'dist'],
  },
});
