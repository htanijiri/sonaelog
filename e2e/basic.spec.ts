import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { cards, login, resetDemo } from './helpers'

test.beforeEach(async ({ request }) => resetDemo(request))

test('000 AC1：デモモードでログインすると見本データの一覧が表示される', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible()
  await page.getByRole('link', { name: '在庫' }).click()
  await expect(cards(page).first()).toBeVisible()
  await expect(page.getByTestId('result-count')).toHaveText('32 明細')
})

test('006 AC8：375px 幅で横スクロールが出ず、主要ボタンが 44px 以上', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  for (const path of ['/', '/items', '/locations', '/review', '/settings']) {
    await page.goto(path)
    await expect(page.getByTestId('local-status')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${path} の横はみ出し`).toBeLessThanOrEqual(0)
  }
  await page.goto('/items')
  await cards(page).first().click()
  for (const name of ['消費・廃棄', '保管場所を移す', '分ける', '1つ増やす', '1つ減らす']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
  for (const name of ['ホーム', '在庫', '保管場所']) {
    const box = await page.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name }).boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
})

test('006 AC10：主要画面に重大なアクセシビリティ違反がない', async ({ page }) => {
  await login(page)
  for (const path of ['/', '/items', '/locations', '/settings']) {
    await page.goto(path)
    await expect(page.getByTestId('local-status')).toBeVisible()
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
    expect(serious.map((v) => `${v.id}: ${v.help}`), path).toEqual([])
  }
})
