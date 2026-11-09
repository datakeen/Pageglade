// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4177',
    channel: process.env.PLAYWRIGHT_CHROME_CHANNEL,
  },
  webServer: {
    command: 'npm run preview -- --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
})
