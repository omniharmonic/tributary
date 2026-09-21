import { defineConfig } from 'vitest/config'

// Standalone on purpose: a stray vite.config.ts lives above the workspace.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts?(x)'],
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
