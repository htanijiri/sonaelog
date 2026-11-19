// spec 010：食料品の味の感想（疑似クラウド・見本データ。感想の見本は fixtures/sample-food-reviews.json）
import { expect, test, type Page } from '@playwright/test'
import { cards, login, resetDemo, USER_B, waitForServiceWorker } from './helpers'

test.beforeEach(async ({ request }) => resetDemo(request))

async function open(page: Page, q: string, nth = 0) {
  await page.goto(`/items?q=${encodeURIComponent(q)}`)
  await cards(page).nth(nth).click()
  await expect(page.getByTestId('lot-detail')).toBeVisible()
}
const section = (page: Page) => page.getByTestId('taste-section')

async function writeReview(page: Page, rating: string, comment: string) {
  await section(page).getByRole('button', { name: /感想を(書く|直す)/ }).click()
  const dialog = page.getByRole('dialog', { name: '味の感想' })
  await dialog.getByRole('radio', { name: rating }).check()
  await dialog.getByLabel(/コメント/).fill(comment)
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('感想を保存しました')).toBeVisible()
}

test('010 AC7：食料品の明細で感想を書くと、同じ品名の別の明細にも出る。食料品以外には欄がない', async ({ page }) => {
  await login(page)
  await open(page, 'クラッカー保存缶', 0)
  await expect(section(page)).toContainText('まだ感想はありません')
  await writeReview(page, '◎ また買う', '塩味がちょうどよい')
  await expect(section(page)).toContainText('また買う')
  await expect(section(page)).toContainText('塩味がちょうどよい')

  // 同じ品名の別の明細（期限・場所が違う）
  await open(page, 'クラッカー保存缶', 2)
  await expect(section(page)).toContainText('塩味がちょうどよい')
  // 一覧の行にも評価が出る
  await page.goto('/items?q=クラッカー保存缶')
  await expect(cards(page)).toHaveCount(3)
  for (let i = 0; i < 3; i++) await expect(cards(page).nth(i).getByTestId('taste-badge')).toHaveText(/また買う/)

  await open(page, '単3')
  await expect(section(page)).toHaveCount(0)
})

test('010 AC7：感想を直す・消す', async ({ page }) => {
  await login(page)
  await open(page, '缶入りパン')
  await expect(section(page)).toContainText('ふつう')
  await expect(section(page)).toContainText('少し甘い')
  await writeReview(page, '× もう買わない', 'パサパサ')
  await expect(section(page)).toContainText('もう買わない')
  await section(page).getByRole('button', { name: '感想を直す' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '感想を消す' }).click()
  await expect(page.getByText('感想を消しました')).toBeVisible()
  await expect(section(page)).toContainText('まだ感想はありません')
})

test('010 AC8：オフラインでも感想は見えるが、書けず「保存しました」も出ない', async ({ page, context }) => {
  await login(page)
  await waitForServiceWorker(page)
  await open(page, 'おかゆ')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('network-status')).toHaveText('オフライン')
  const writes: string[] = []
  page.on('request', (r) => r.url().includes('/__demo_api/change') && writes.push(r.url()))
  await expect(section(page)).toContainText('味が薄い')
  await expect(section(page).getByRole('button', { name: '感想を直す' })).toBeDisabled()

  await page.goto('/food-reviews')
  await expect(page.getByTestId('taste-row')).toHaveCount(4)
  for (const b of await page.getByRole('button', { name: '感想を直す' }).all()) await expect(b).toBeDisabled()
  expect(writes).toEqual([])
  await expect(page.getByText(/保存しました/)).toHaveCount(0)
})

test('010 AC9：食べ切った品の感想は「味の感想」の画面に在庫なしで残る', async ({ page }) => {
  await login(page)
  await open(page, 'おかゆ')
  await page.getByRole('button', { name: '消費・廃棄' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '消費する' }).click()
  await expect(page.getByText('2袋を消費しました')).toBeVisible()

  await page.goto('/items')
  await page.getByRole('link', { name: /味の感想の一覧/ }).click()
  const row = page.getByTestId('taste-row').filter({ hasText: '見本のおかゆ' })
  await expect(row.getByTestId('taste-stock')).toHaveText('在庫なし')
  await expect(row).toContainText('もう買わない')
  await expect(row).toContainText('味が薄い')
  // 並び：また買う → ふつう → もう買わない
  await expect(page.getByTestId('taste-row').first()).toContainText('また買う')
  await expect(page.getByTestId('taste-row').last()).toContainText('もう買わない')
})

test('010 AC10：キーワード検索で感想のコメントに一致する食料品が見つかる', async ({ page }) => {
  await login(page)
  await page.goto('/items')
  await page.getByLabel('キーワード').fill('子どもも完食')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('見本の保存ご飯・五目')
  await expect(cards(page).first().getByTestId('taste-badge')).toHaveText(/また買う/)
})

test('010 AC11：食料品を追加するとき、同じ品名の感想が表示される', async ({ page }) => {
  await login(page)
  await page.goto('/items/new')
  await expect(page.getByTestId('taste-hint')).toHaveCount(0)
  // 全角・半角や空白の違いは同じ品名とみなす
  await page.getByLabel('品名').fill(' 見本のおかゆ　')
  await page.getByLabel('カテゴリ').selectOption({ label: '食品' })
  await expect(page.getByTestId('taste-hint')).toContainText('味が薄い')
  await page.getByLabel('カテゴリ').selectOption({ label: '水' })
  await expect(page.getByTestId('taste-hint')).toHaveCount(0)
})

test('010 AC13：端末A の感想は、端末B の同期後に表示される', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await login(a)
  await login(b, USER_B)

  // 端末B：先に明細を開いておく（再読み込みすると起動時の同期が走るため）
  await open(b, 'クラッカー保存缶')
  await expect(section(b)).toContainText('まだ感想はありません')

  await open(a, 'クラッカー保存缶')
  await writeReview(a, '○ ふつう', '端末Aから')

  await expect(section(b)).toContainText('まだ感想はありません')
  await b.getByRole('button', { name: '今すぐ同期' }).click()
  await expect(section(b)).toContainText('端末Aから')
  await expect(section(b)).toContainText('ふつう')
  await ctxA.close()
  await ctxB.close()
})
