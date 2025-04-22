import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  splitting: false,
  clean: true,
  target: 'es2017',
  external: [...Object.keys(require('./package.json').dependencies || {})],
  esbuildOptions(options) {
    options.platform = 'node';
    return options;
  },
});
