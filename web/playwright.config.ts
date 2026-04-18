import { defineConfig } from '@playwright/test';

const BASE_PATH = '/appearance-ranking-and-lookalike/';
const PORT = 5173;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
