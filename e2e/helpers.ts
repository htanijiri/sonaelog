import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const USER_A = { email: 'a@example.test', password: 'demo-pass-a' }
export const USER_B = { email: 'b@example.test', password: 'demo-pass-b' }

/** 疑似クラウドを初期状態に戻す（テストごとに呼ぶ） */
export async function resetDemo(request: APIRequestContext) {
  const res = await request.post('/__demo_api/__control', { data: { reset: true } })
  expect(res.ok()).toBeTruthy()
}

export async function control(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/__demo_api/__control', { data })
  expect(res.ok()).toBeTruthy()
}

/** ログインして、端末への保存が終わるまで待つ */
export async function login(page: Page, user = USER_A) {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(user.email)
  await page.getByLabel('パスワード').fill(user.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み')
}

/** Service Worker がアプリの画面をキャッシュし終えるまで待つ */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker?.getRegistration()
    return reg?.active?.state === 'activated'
  })
  // 初回のページも再読み込みなしで制御下に入ること（clientsClaim）を確かめる
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
}

/** 一覧のカード（スマホ表示） */
export const cards = (page: Page) => page.getByTestId('lot-card')
