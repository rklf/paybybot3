import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys, run on the built app (paybybot3/static, `npm run build` first) served by the Python server,
 * as online: one origin, invite-only, PayByPhone replaced by the demo account. Its own port, so it never meets a
 * dev server. `npm run e2e` builds, then runs them on a computer screen and on a phone.
 */
const PORT = 8790
export const CODE = 'e2ecode'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'fr-FR', timezoneId: 'Europe/Paris', trace: 'retain-on-failure' },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `env PAYBYBOT_INVITE_ONLY=1 PAYBYBOT_INVITE_CODE=${CODE} ../venv/bin/python -m uvicorn paybybot3.web:app --port ${PORT} --app-dir ..`,
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
