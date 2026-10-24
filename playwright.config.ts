import { defineConfig } from '@playwright/test';

const PORT = 8797;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10_000,
  },
  webServer: {
    command: 'npx vite build --logLevel warn && npx tsx src/server/index.ts',
    env: { ...process.env, PORT: String(PORT), STATIC_DIR: 'dist' },
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
