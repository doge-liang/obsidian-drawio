import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The obsidian npm package is types-only; point runtime imports at a stub.
    alias: { obsidian: new URL('./tests/obsidian-stub.ts', import.meta.url).pathname },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
