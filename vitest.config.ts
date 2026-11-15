import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    env: { NODE_ENV: 'test', UPLOAD_DIR: '.data/test-uploads', LOG_DIR: '.data/test-logs' },
  },
});
