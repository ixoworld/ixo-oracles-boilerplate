import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/live-agent/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: ['react', 'react-dom'],
});
