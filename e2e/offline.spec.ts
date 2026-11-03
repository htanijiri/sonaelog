import { expect, test } from '@playwright/test'
import { cards, control, login, resetDemo, USER_B, waitForServiceWorker } from './helpers'

test.beforeEach(async ({ request }) => resetDemo(request))

test('005 AC1・006 AC7：オフラインで再読み込みしても、全画面を表示・検索できる', async ({ page, context }) => {
  await login(page)
  await waitForServiceWorker(page)
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('network-status')).toHaveText('オフライン')
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み（最終同期：')
  await expect(page.getByTestId('counter-expired')).toContainText('3')

  // 在庫の検索（オンラインと同じ結果）
  await page.getByRole('link', { name: '在庫' }).click()
  await page.getByLabel('キーワード').fill('単3')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('見本の単3形乾電池')
  await expect(cards(page).first()).toContainText('24本')
  await expect(cards(page).first()).toContainText('見本 収納ボックス')

  // 保管場所・明細へも遷移できる（URL を直接開いても Service Worker が画面を返す）
  await page.goto('/locations')
  await expect(page.getByTestId('location-card')).toHaveCount(11)
  await page.getByTestId('location-card').filter({ hasText: 'Aさん用' }).click()
  await expect(page.getByRole('heading', { name: '見本 持ち出し：Aさん用' })).toBeVisible()
  await cards(page).first().click()
  await expect(page.getByTestId('lot-detail')).toBeVisible()
  await page.goto('/settings')
  await expect(page.getByTestId('settings-counts')).toHaveText('明細 32 件・保管場所 11 か所')
})

test('005 AC2・007 AC7：オフラインでは編集ボタンが無効で、疑似クラウドへの書き込みが起きない', async ({ page, context }) => {
  await login(page)
  await waitForServiceWorker(page)
  await page.goto('/items?q=単3')
  await cards(page).first().click()
  await context.setOffline(true)
  await expect(page.getByTestId('network-status')).toHaveText('オフライン')

  const writes: string[] = []
  page.on('request', (r) => r.url().includes('/__demo_api/change') && writes.push(r.url()))
  for (const name of ['消費・廃棄', '保管場所を移す', '分ける', '1つ増やす', '1つ減らす', '数量を保存']) {
    await expect(page.getByRole('button', { name })).toBeDisabled()
  }
  await expect(page.getByRole('link', { name: /編集/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('オフラインのため閲覧のみです')).toBeVisible()
  await page.goto('/items')
  await expect(page.getByRole('link', { name: '＋ 追加' })).toHaveCount(0)
  expect(writes).toEqual([])
  await expect(page.getByText('保存しました')).toHaveCount(0)
})

test('007 AC7：通信中に切断されたら「保存できませんでした」を出し、「保存しました」を出さない', async ({ page }) => {
  await login(page)
  await page.goto('/items?q=単3')
  await cards(page).first().click()
  // 送信中に回線が切れた状態を再現する（setOffline は送信済みのリクエストを止めないため）
  await page.route('**/__demo_api/change', (route) => route.abort('internetdisconnected'))
  await page.getByRole('button', { name: '1つ増やす' }).click()
  await expect(page.getByText(/保存できませんでした：オフラインのため保存できませんでした/)).toBeVisible()
  await expect(page.getByText(/保存しました|にしました/)).toHaveCount(0)
  await expect(page.getByTestId('lot-detail')).toContainText('24本')
})

test('005 AC5・007 AC1：端末A の変更は端末B の同期まで反映されず、同期後に一致する', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await login(a)
  await login(b, USER_B)
  const syncedB = await b.getByTestId('local-status').textContent()

  // 端末A：明細を追加（期限は年月）
  await a.goto('/items/new')
  await a.getByLabel('品名').fill('E2E で追加した缶詰')
  await a.getByLabel('数量').fill('3')
  await a.getByLabel('単位').fill('缶')
  await a.getByLabel('保管場所').selectOption({ label: '見本 持ち出し：Bさん用' })
  await a.getByRole('radio', { name: '年月', exact: true }).first().check()
  await a.getByLabel('期限', { exact: true }).fill('2028-04')
  await a.getByRole('button', { name: '保存する' }).click()
  await expect(a.getByText('追加しました')).toBeVisible()
  // 端末A のローカルも更新される
  await a.getByLabel('キーワード').fill('E2E で追加')
  await expect(cards(a)).toHaveCount(1)
  await expect(cards(a).first()).toContainText('2028年4月')

  // 端末B：同期前は古いまま（最終同期日時も変わらない）。再読み込みすると起動時の同期が走るので、画面内で移動する
  await b.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name: '在庫' }).click()
  await b.getByLabel('キーワード').fill('E2E')
  await expect(b.getByTestId('result-count')).toHaveText('0 明細')
  await expect(b.getByTestId('local-status')).toHaveText(syncedB!)

  // 端末B：今すぐ同期 → 一致する
  await b.getByRole('button', { name: '今すぐ同期' }).click()
  await expect(cards(b)).toHaveCount(1)
  await expect(cards(b).first()).toContainText('3缶')
  await expect(cards(b).first()).toContainText('見本 持ち出し：Bさん用')
  await expect(cards(b).first()).toContainText('2028年4月')
  await ctxA.close()
  await ctxB.close()
})

test('005 AC6：クラウドには保存できたが再取得に失敗したら、未更新の警告と再同期ボタン', async ({ page, request }) => {
  await login(page)
  await page.goto('/items?q=単3')
  await cards(page).first().click()
  await control(request, { failSnapshot: 1 })
  await page.getByRole('button', { name: '1つ増やす' }).click()
  const warning = page.locator('.statusbar').getByText('クラウドには保存済み・この端末は未更新です。')
  await expect(warning).toBeVisible()
  await expect(page.getByText('保存しました', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '再同期' }).click()
  await expect(warning).toHaveCount(0)
  await expect(page.getByTestId('lot-detail')).toContainText('25本')
})

test('005 AC3：壊れたデータを受け取っても保存せず、最終同期時点の情報を表示し続ける', async ({ page, request }) => {
  await login(page)
  const before = await page.getByTestId('local-status').textContent()
  await control(request, { corruptSnapshot: 1 })
  await page.getByRole('button', { name: '今すぐ同期' }).click()
  await expect(page.getByTestId('network-status')).toHaveText('同期失敗')
  await expect(page.getByText(/表示しているのは最終同期時点の情報です/)).toBeVisible()
  await expect(page.getByTestId('local-status')).toHaveText(before!)
  await expect(page.getByTestId('counter-expired')).toContainText('3')
})

test('005 AC7・004 AC5：端末に保存がないままオフラインなら「在庫 0 件」ではなく未保存と表示する', async ({ page, context }) => {
  await page.goto('/login')
  await waitForServiceWorker(page)
  await context.setOffline(true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'この端末にはまだ在庫が保存されていません' })).toBeVisible()
  await expect(page.getByText('在庫が 0 件という意味ではありません')).toBeVisible()
  await expect(page.getByTestId('local-status')).toHaveText('未保存（オフラインでは使用不可）')
  await expect(page.getByText('0 明細')).toHaveCount(0)
})

test('005 AC8：Service Worker のキャッシュに API の応答や認証情報が入らない', async ({ page }) => {
  await login(page)
  await waitForServiceWorker(page)
  await page.reload()
  await page.goto('/items')
  await page.getByRole('button', { name: '今すぐ同期' }).click()
  await expect(page.getByTestId('network-status')).toHaveText('オンライン')
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) urls.push(req.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(3)
  expect(cached.filter((u) => /__demo_api|supabase\.co|auth|token|snapshot/.test(u))).toEqual([])
  expect(cached.every((u) => /\.(js|css|html|png|svg|webmanifest)(\?|$)/.test(u))).toBe(true)
})

test('004 AC3：ログインの有効期限が切れた状態でも、オフラインで保存済みの在庫を閲覧できる', async ({ page, context, request }) => {
  await login(page)
  await waitForServiceWorker(page)
  // 端末内のセッションを期限切れにし、クラウド側でも失効させる
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sonaelog-demo-session')!)
    s.expires_at = 1
    localStorage.setItem('sonaelog-demo-session', JSON.stringify(s))
  })
  await control(request, { revokeAll: true })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('local-status')).toContainText('この端末に保存済み')
  await page.getByRole('link', { name: '在庫' }).click()
  await page.getByLabel('キーワード').fill('湧き水')
  await expect(cards(page)).toHaveCount(2)
})

test('004 AC4：オンラインでセッションが失効していたら、閲覧のまま再ログインを促し、編集を止める', async ({ page, request }) => {
  await login(page)
  await control(request, { revokeAll: true, expireTokens: true })
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sonaelog-demo-session')!)
    s.expires_at = 1
    localStorage.setItem('sonaelog-demo-session', JSON.stringify(s))
  })
  await page.reload()
  await expect(page.getByText(/ログインの有効期限が切れました。/)).toBeVisible()
  await expect(page.getByTestId('counter-expired')).toContainText('3')
  await page.goto('/items?q=単3')
  await cards(page).first().click()
  await expect(page.getByRole('button', { name: '消費・廃棄' })).toBeDisabled()
  // 再ログインすると編集できる
  await page.getByRole('link', { name: 'ログイン' }).click()
  await page.getByLabel('パスワード').fill('demo-pass-a')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible()
  await page.goto('/items?q=単3')
  await cards(page).first().click()
  await expect(page.getByRole('button', { name: '消費・廃棄' })).toBeEnabled()
})

test('004 AC1：ログインに失敗したら日本語のエラーを出す。新規登録の画面はない', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill('a@example.test')
  await page.getByLabel('パスワード').fill('wrong')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います')
  await expect(page.getByText(/新規登録/)).toHaveText(/新規登録はできません/)
  await expect(page.getByRole('link', { name: /登録/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /登録/ })).toHaveCount(0)
})
