import { expect, test } from '@playwright/test'
import { cards, login, resetDemo } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request)
  await login(page)
})

test('006 AC2：同名で期限違いの品が2枚のカードで、期限切れの方だけ「期限切れ」「生活用水候補」', async ({ page }) => {
  await page.goto('/items?q=湧き水')
  await expect(cards(page)).toHaveCount(2)
  const [old, fresh] = [cards(page).nth(0), cards(page).nth(1)]
  await expect(old).toContainText('2025年11月')
  await expect(old).toContainText('期限切れ')
  await expect(old).toContainText('生活用水候補')
  await expect(fresh).toContainText('2027年3月')
  await expect(fresh).toContainText('1年以内')
  await expect(fresh).not.toContainText('生活用水候補')
})

test('006 AC3：同名の品が複数の保管場所にあれば、場所ごとのカードが出る', async ({ page }) => {
  await page.goto('/items?q=クラッカー')
  await expect(cards(page)).toHaveCount(3)
  for (const place of ['見本 収納ボックス', 'Aさん用', 'Bさん用']) {
    await expect(cards(page).filter({ hasText: place })).toHaveCount(1)
  }
})

test('006 AC4：ホームの件数を押すと、その条件で絞り込んだ一覧が開き、件数が一致する', async ({ page }) => {
  for (const [id, label] of [['expired', '期限切れ'], ['within_1_year', '1年以内'], ['unknown', '期限未確認']] as const) {
    await page.goto('/')
    const counter = page.getByTestId(`counter-${id}`)
    const n = Number((await counter.locator('.counter-num').textContent())!.trim())
    await counter.click()
    await expect(page.getByTestId('result-count')).toHaveText(`${n} 明細`)
    if (n > 0) await expect(cards(page).first()).toContainText(label)
  }
  await page.goto('/')
  const reviewN = Number((await page.getByTestId('counter-review').locator('.counter-num').textContent())!.trim())
  await page.getByTestId('counter-review').click()
  await expect(cards(page)).toHaveCount(reviewN)
})

test('006 AC5：保管場所画面に持ち出しリュック4か所が個別に表示され、明細数が正しい', async ({ page }) => {
  await page.goto('/locations')
  const bags = page.getByRole('region', { name: '非常持ち出し' }).getByTestId('location-card')
  await expect(bags).toHaveCount(4)
  const expected: Record<string, number> = { Aさん用: 4, Bさん用: 3, Cさん用: 2, Dさん用: 3 }
  for (const [name, n] of Object.entries(expected)) {
    await expect(bags.filter({ hasText: name }).getByTestId('location-lot-count')).toHaveText(`${n} 明細`)
  }
  await expect(page.getByText('論理上の置き場所です（実際の置き場所は未確認）')).toBeVisible()
})

test('006 AC6：年月だけの期限は「YYYY年M月」で、日にちが出ない。計算した期限は計算元を表示', async ({ page }) => {
  await page.goto('/items?q=缶入りパン')
  await expect(cards(page).first()).toContainText('期限：2027年8月')
  await cards(page).first().click()
  await expect(page.getByTestId('lot-detail')).toContainText('2027年8月')
  await expect(page.getByTestId('lot-detail')).not.toContainText('2027年8月1日')
  await expect(page.getByTestId('lot-detail')).not.toContainText('2027年8月31日')
  await page.goto('/items?q=カセットガス')
  await expect(cards(page).first()).toContainText('2031年5月（計算）')
  await cards(page).first().click()
  await expect(page.getByTestId('lot-detail')).toContainText('製造2024年5月から7年で計算')
})

test('期限が分からない品は「未確認」で、残り日数を出さない', async ({ page }) => {
  await page.goto('/items?q=単1')
  await cards(page).first().click()
  await expect(page.getByTestId('lot-detail')).toContainText('未確認')
  await expect(page.getByTestId('lot-detail')).not.toContainText('あと')
})

test('セット商品の中身は参考として表示し、合計に足さない', async ({ page }) => {
  await page.goto('/items?q=防災食')
  await cards(page).first().click()
  await expect(page.getByTestId('lot-detail')).toContainText('セットの中身（参考）')
  await expect(page.getByTestId('lot-detail')).toContainText('2箱で計20袋（参考。合計には足していません）')
  await page.goto('/')
  await expect(page.getByTestId('meal-summary')).toContainText('18食')
})
