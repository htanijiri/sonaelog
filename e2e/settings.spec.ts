import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { login, resetDemo, waitForServiceWorker } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request)
  await login(page)
})

test('008 AC3：オフラインでも JSON・CSV を書き出せる', async ({ page, context }) => {
  await waitForServiceWorker(page)
  await context.setOffline(true)
  await page.goto('/settings')
  await expect(page.getByTestId('settings-counts')).toHaveText('明細 32 件・保管場所 11 か所')
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON で書き出す' }).click()])
  expect(json.suggestedFilename()).toMatch(/^sonaelog-\d{8}-\d{4}-同期\d{8}-\d{4}\.json$/)
  const data = JSON.parse(readFileSync((await json.path())!, 'utf8'))
  expect(data.format).toBe('sonaelog-export')
  expect(data.lots).toHaveLength(32)
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV で書き出す/ }).click()])
  const text = readFileSync((await csv.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.split('\r\n').filter(Boolean)).toHaveLength(33)
})

test('008：設定画面に保存状況・永続保存・版を表示する', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByTestId('settings-email')).toHaveText('a@example.test')
  await expect(page.getByTestId('persist-status')).not.toHaveText('未申請')
  await expect(page.getByText('この端末のデータが消える場合')).toBeVisible()
})

test('008 AC4：「ログアウトだけ」では在庫が残り、オフラインで閲覧できる', async ({ page, context }) => {
  await waitForServiceWorker(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'ログアウトだけ（在庫は残す）' }).click()
  await expect(page.getByText('ログアウトしました（この端末の在庫は残っています）')).toBeVisible()
  await expect(page.getByText(/ログインしていません。/)).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み')
  await page.goto('/items?q=単3')
  await expect(page.getByTestId('lot-card')).toHaveCount(1)
})

test('008 AC5：「ログアウトして消す」は確認を経て、端末の在庫とセッションを消す', async ({ page, context }) => {
  await waitForServiceWorker(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'ログアウトして、この端末の在庫も消す' }).click()
  await expect(page.getByRole('dialog')).toContainText('ネットにつないでログインするまで在庫を見られなくなります')
  await page.getByRole('dialog').getByRole('button', { name: 'やめる' }).click()
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み')
  await page.getByRole('button', { name: 'ログアウトして、この端末の在庫も消す' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '消してログアウト' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('sonaelog-demo-session'))).toBeNull()
  await context.setOffline(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'この端末にはまだ在庫が保存されていません' })).toBeVisible()
  await expect(page.getByTestId('local-status')).toHaveText('未保存（オフラインでは使用不可）')
})
