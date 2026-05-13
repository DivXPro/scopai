import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['@scopai/core', 'duckdb'],
  minify: true,
  onSuccess: 'cp -r src/mcp-ui dist/mcp-ui 2>/dev/null || true',
});
