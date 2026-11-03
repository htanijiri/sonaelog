import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// e2e/ は架空の見本データ、data/checks/ は実データでの確認（ローカル限定。フォルダがあるときだけ）
const testMatch = ['e2e/**/*.spec.ts']
if (existsSync('data/checks')) testMatch.push('data/checks/**/*.spec.ts')

export default defineConfig({
  testDir: '.',
  testMatch,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    ...devices['Pixel 7'],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Service Worker を効かせるため、開発サーバーではなく E2E 用ビルドを preview で配信する
    command: 'npm run build:e2e && npm run preview:e2e',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { DEMO_DATA: process.env.DEMO_DATA ?? 'fixtures/sample-data.json' },
  },
})
