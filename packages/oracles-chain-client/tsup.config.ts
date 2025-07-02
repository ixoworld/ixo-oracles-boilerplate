import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    entry: 'src/index.ts',
    resolve: true,
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: 'dist',
  outExtension({ format }) {
    if (format === 'esm') {
      return {
        js: '.js',
      };
    }
    if (format === 'cjs') {
      return {
        js: '.js',
      };
    }
    return {
      js: '.js',
    };
  },
  onSuccess: 'echo "Build completed successfully!"',
  esbuildOptions(options, context) {
    if (context.format === 'cjs') {
      options.outdir = 'dist/cjs';
    }
    if (context.format === 'esm') {
      options.outdir = 'dist/esm';
    }
  },
});
