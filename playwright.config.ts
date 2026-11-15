import { defineConfig } from '@playwright/test';

/** Browser end-to-end tests. First time only: `npx playwright install chromium`. Then `npm run test:e2e`. */
export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3200', ...(process.env.PW_CHROME ? { launchOptions: { executablePath: process.env.PW_CHROME } } : {}) },
  webServer: {
    command: 'npm run build && npm start',
    env: { PORT: '3200', PGLITE_DIR: 'memory', UPLOAD_DIR: '.data/e2e-uploads' },
    url: 'http://localhost:3200/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
