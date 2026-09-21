import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/tributary_test', NODE_ENV: 'test' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
