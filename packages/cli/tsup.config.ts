import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['@scopai/core', 'duckdb'],
  minify: true,
});
