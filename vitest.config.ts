import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// 実データでの確認（data/checks/）は、フォルダがあるときだけ対象にする（公開リポジトリには置かないため）
const include = ['tests/**/*.test.ts']
if (existsSync('data/checks')) include.push('data/checks/**/*.test.ts')

export default defineConfig({
  test: {
    include,
    environment: 'node',
    testTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
  },
})
