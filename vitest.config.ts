import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // The obsidian npm package is types-only; point runtime imports at a stub.
    alias: { obsidian: fileURLToPath(new URL('./tests/obsidian-stub.ts', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
