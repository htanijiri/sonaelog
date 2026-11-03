import { expect, test, type Page } from '@playwright/test'
import { cards, login, resetDemo } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request)
  await login(page)
})

async function open(page: Page, q: string, nth = 0) {
  await page.goto(`/items?q=${encodeURIComponent(q)}`)
  await cards(page).nth(nth).click()
  await expect(page.getByTestId('lot-detail')).toBeVisible()
}

test('数量の＋／－と直接入力', async ({ page }) => {
  await open(page, '単3')
  await page.getByRole('button', { name: '1つ増やす' }).click()
  await expect(page.getByText('数量を25本にしました')).toBeVisible()
  await expect(page.getByTestId('lot-detail')).toContainText('25本')
  await page.getByRole('spinbutton', { name: '数量' }).fill('30')
  await page.getByRole('button', { name: '数量を保存' }).click()
  await expect(page.getByTestId('lot-detail')).toContainText('30本')
})

test('007 AC2：消費で 0 になった明細は一覧・検索・保管場所から消え、記録が残る', async ({ page, request }) => {
  await open(page, '単1')
  await page.getByRole('button', { name: '消費・廃棄' }).click()
  await page.getByRole('dialog').getByLabel(/数/).fill('6')
  await expect(page.getByText('通常の一覧から消えます')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '消費する' }).click()
  await expect(page.getByText('6本を消費しました')).toBeVisible()
  await page.goto('/items?q=単1')
  await expect(page.getByTestId('result-count')).toHaveText('0 明細')
  await page.goto('/locations')
  await expect(page.getByTestId('location-card').filter({ hasText: '見本 収納ボックス' }).getByTestId('location-lot-count')).toHaveText('7 明細')
  const events = await (await request.get('/__demo_api/__events')).json()
  expect(events.map((e: { event_type: string }) => e.event_type)).toContain('consumed')
})

test('007 AC3：期限を「年月」で入れると年月のまま保存される（日付を補わない）', async ({ page }) => {
  await open(page, '単3')
  await page.getByRole('link', { name: /編集/ }).click()
  await page.getByRole('radio', { name: '年月', exact: true }).first().check()
  await page.getByLabel('期限', { exact: true }).fill('2029-06')
  await page.getByLabel('期限の種類').selectOption({ label: '使用・点検期限' })
  await page.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page.getByTestId('lot-detail')).toContainText('使用・点検期限')
  await expect(page.getByTestId('lot-detail')).toContainText('2029年6月')
  await expect(page.getByTestId('lot-detail')).not.toContainText('2029年6月1日')
})

test('007 AC4：一部だけ移すと、元が減り、移動先に別の明細ができる', async ({ page }) => {
  await open(page, '単3')
  await page.getByRole('button', { name: '保管場所を移す' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('移す先').selectOption({ label: '見本 持ち出し：Cさん用' })
  await dialog.getByRole('radio', { name: /一部だけ/ }).check()
  await dialog.getByLabel('移す数').fill('4')
  await dialog.getByRole('button', { name: '移す' }).click()
  await expect(page.getByText('保管場所を移しました')).toBeVisible()
  await expect(page.getByTestId('lot-detail')).toContainText('20本')
  await page.goto('/items?q=単3')
  await expect(cards(page)).toHaveCount(2)
  await expect(cards(page).filter({ hasText: 'Cさん用' })).toContainText('4本')
})

test('007 AC5：買い替えで古い明細が外れ、新しい期限の明細が別に追加される', async ({ page }) => {
  await open(page, '缶入りパン')
  await page.getByRole('link', { name: '買い替え' }).click()
  await expect(page.getByRole('heading', { name: '買い替え：見本の缶入りパン' })).toBeVisible()
  await page.getByRole('radio', { name: '年月', exact: true }).first().check()
  await page.getByLabel('期限', { exact: true }).fill('2031-02')
  await page.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('買い替えを保存しました')).toBeVisible()
  await page.goto('/items?q=缶入りパン')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('2031年2月')
  await expect(cards(page).first()).not.toContainText('買い替え予定')
})

test('007 AC6：分けるで親が減り、中身の明細ができる（確認画面あり）', async ({ page }) => {
  await open(page, '防災食')
  await page.getByRole('button', { name: '分ける' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('品名1')).toHaveValue('白米')
  await dialog.getByRole('button', { name: '確認へ' }).click()
  await expect(dialog.getByText(/1箱 減らし、3 件の明細を作ります/)).toBeVisible()
  await dialog.getByRole('button', { name: '分ける' }).click()
  await expect(page.getByText('明細を分けました')).toBeVisible()
  await expect(page.getByTestId('lot-detail')).toContainText('1箱')
  await page.goto('/items?q=豚汁')
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('3袋')
})

test('007 AC8：ほかの家族が先に変更していたら、上書きせず競合のメッセージを出す', async ({ page, request }) => {
  await open(page, '単3')
  // 別の家族（API で直接）が先に変更する
  const token = (await (await request.post('/__demo_api/auth/sign-in', { data: { email: 'b@example.test', password: 'demo-pass-b' } })).json()).access_token
  const snap = await (await request.get('/__demo_api/snapshot', { headers: { Authorization: `Bearer ${token}` } })).json()
  const lot = snap.lots.find((l: { name: string }) => l.name === '見本の単3形乾電池')
  await request.post('/__demo_api/change', { headers: { Authorization: `Bearer ${token}` }, data: { type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 50 } })
  // こちらは古い情報のまま変更しようとする
  await page.getByRole('button', { name: '1つ増やす' }).click()
  await expect(page.getByText(/ほかの家族が先に変更しました/)).toBeVisible()
  // 最新を読み込むと、先に入った変更が残っている
  await expect(page.getByTestId('lot-detail')).toContainText('50本')
})

test('007 AC9：要確認の一覧から確認済みにすると、一覧から外れる', async ({ page }) => {
  await page.goto('/review')
  const before = await cards(page).count()
  expect(before).toBe(8)
  await cards(page).filter({ hasText: 'LEDライト' }).click()
  await expect(page.getByTestId('lot-detail')).toContainText('写真からの仮登録')
  await page.getByRole('button', { name: '確認済みにする' }).click()
  await page.getByRole('dialog').getByLabel(/メモ/).fill('実物で確認した')
  await page.getByRole('dialog').getByRole('button', { name: '確認済みにする' }).click()
  await expect(page.getByText('確認済みにしました')).toBeVisible()
  await expect(page.getByTestId('lot-detail')).toContainText('確認済み')
  await expect(page.getByTestId('lot-detail')).toContainText('実物で確認した')
  await page.goto('/review')
  await expect(cards(page)).toHaveCount(before - 1)
})

test('007 AC10：保管場所の名前・説明の編集、追加、空の場所の削除。中身がある場所は削除できない', async ({ page }) => {
  await page.goto('/locations')
  await page.getByTestId('location-card').filter({ hasText: 'Aさん用' }).click()
  await expect(page.getByRole('button', { name: 'この場所を削除' })).toHaveCount(0)
  await page.getByRole('button', { name: '名前・説明を編集' }).click()
  await page.getByRole('dialog').getByLabel(/場所の説明/).fill('玄関のクローゼット上段')
  await page.getByRole('dialog').getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('場所の説明：玄関のクローゼット上段')).toBeVisible()

  await page.goto('/locations')
  await page.getByRole('button', { name: '＋ 場所を追加' }).click()
  await page.getByRole('dialog').getByLabel('名前').fill('車のトランク')
  await page.getByRole('dialog').getByLabel('区分').selectOption({ label: 'その他' })
  await page.getByRole('dialog').getByRole('button', { name: '保存する' }).click()
  await expect(page.getByTestId('location-card').filter({ hasText: '車のトランク' })).toBeVisible()
  await page.getByTestId('location-card').filter({ hasText: '車のトランク' }).click()
  await page.getByRole('button', { name: 'この場所を削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('保管場所を削除しました')).toBeVisible()
  await expect(page.getByTestId('location-card').filter({ hasText: '車のトランク' })).toHaveCount(0)
})

test('007 AC11：負の数量・空の品名・存在しない日付はフォームで止まり、送信されない', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (r) => r.url().includes('/__demo_api/change') && writes.push(r.url()))
  await page.goto('/items/new')
  await page.getByLabel('数量').fill('-1')
  await page.getByRole('radio', { name: '年月日' }).first().check()
  await page.getByRole('button', { name: '保存する' }).click()
  const errors = page.locator('.field-errors')
  await expect(errors).toContainText('品名')
  await expect(errors).toContainText('数量')
  await expect(errors).toContainText('期限の日付を入れるか')
  expect(writes).toEqual([])
})

test('007 AC12：製造年月と年数から期限を計算して表示し、保存後も反映される', async ({ page }) => {
  await page.goto('/items/new')
  await page.getByLabel('品名').fill('カセットガス（新）')
  await page.getByLabel('数量').fill('3')
  await page.getByLabel('単位').fill('本')
  await page.getByLabel('カテゴリ').selectOption({ label: '燃料' })
  await page.getByRole('group', { name: /期限（印字/ }).getByRole('radio', { name: 'なし' }).check()
  await page.getByRole('group', { name: /製造年月/ }).getByRole('radio', { name: '年月', exact: true }).check()
  await page.getByLabel('製造年月').fill('2025-10')
  await page.getByRole('button', { name: 'カセットガス：製造から7年' }).click()
  await expect(page.getByLabel('製造から何年')).toHaveValue('7')
  await expect(page.getByTestId('expiry-preview')).toHaveText('計算した期限：2032年10月（製造2025年10月から7年で計算）')
  await page.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('追加しました')).toBeVisible()
  await page.getByLabel('キーワード').fill('カセットガス（新）')
  await expect(cards(page).first()).toContainText('2032年10月（計算）')
  await expect(cards(page).first()).toContainText('期限内')
  // 同じ品名の候補に、使った年数が出る
  await page.goto('/items/new')
  await page.getByLabel('品名').fill('見本のカセットガス')
  await expect(page.getByRole('button', { name: '前回の「見本のカセットガス」：製造から7年' })).toBeVisible()
})
