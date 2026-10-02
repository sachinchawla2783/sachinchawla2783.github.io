'use strict';
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: 'node e2e/server.js',
    url: 'http://localhost:3200/api/auth/session',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
