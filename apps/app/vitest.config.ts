import path from 'path';
import { fileURLToPath } from 'url';
import { mergeConfig } from '@ixo/vitest-config/base';
import config from '@ixo/vitest-config/nest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(config, {
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  test: {
    root: '.',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
