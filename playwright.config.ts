import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  timeout: 120_000,
  retries: 0,
  workers: 1, // Serial execution — tests share state across the lifecycle
  use: {
    baseURL: process.env.BASE_URL || 'https://naipepea.digit.org',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
