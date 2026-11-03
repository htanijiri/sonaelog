import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../../src/domain/types'
import { createDb, lotInput, rpc, setupHouseholds, user } from './harness'

let db: PGlite
let ids: Awaited<ReturnType<typeof setupHouseholds>>

beforeEach(async () => {
  db = await createDb()
  ids = await setupHouseholds(db)
}, 60_000)

const snapshot = () => rpc<Snapshot>(db, user(ids.userA), 'get_household_snapshot')
const change = (c: Record<string, unknown>, who = ids.userA) => rpc(db, user(who), 'apply_change', { p_change: c })
async function createLot(patch: Record<string, unknown> = {}) {
  await change({ type: 'create_lot', lot: lotInput(ids.locA1, patch) })
  const s = await snapshot()
  return s.lots[s.lots.length - 1]!
}
const events = async () =>
  (await db.query<{ event_type: string; lot_id: string | null; actor_user_id: string | null }>(
    `select event_type, lot_id, actor_user_id from public.inventory_change_events order by occurred_at`,
  )).rows
const revision = async () =>
  Number((await db.query<{ revision: string }>(`select revision::text from public.households where id = $1`, [ids.homeA])).rows[0]!.revision)

describe('001 AC5：DB 制約で不正な値を拒否する', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['13月', { expiry_value: '2027-13' }],
    ['存在しない日', { expiry_value: '2027-02-30', expiry_precision: 'day' }],
    ['月精度なのに日付', { expiry_value: '2027-02-01', expiry_precision: 'month' }],
    ['期限ありなのに精度なし', { expiry_precision: null }],
    ['期限なしなのに記録済み', { expiry_value: null, expiry_precision: null }],
    ['期限ありなのに未確認', { expiry_check: 'not_recorded' }],
    ['製造年月の形式違い', { manufactured_value: '2024/05', manufactured_precision: 'month' }],
    ['製造年月ありなのに精度なし', { manufactured_value: '2024-05' }],
    ['0 以下の年数', { shelf_life_months: 0 }],
    ['負の数量', { quantity: -1 }],
    ['未知のカテゴリ', { category: 'snack' }],
  ]
  for (const [label, patch] of bad) {
    it(label, async () => {
      await expect(change({ type: 'create_lot', lot: lotInput(ids.locA1, patch) })).rejects.toThrow()
      expect((await snapshot()).lots).toHaveLength(0)
    })
  }
  it('存在しない保管場所', async () => {
    await expect(change({ type: 'create_lot', lot: lotInput('00000000-0000-4000-8000-000000000000') })).rejects.toThrow(/保管場所が見つかりません/)
  })
  it('直接 INSERT でも別家庭の保管場所は参照できない（複合外部キー）', async () => {
    await expect(
      db.query(
        `insert into public.inventory_lots (household_id, location_id, name, category, quantity, unit, expiry_check, use_status, source) values ($1, $2, 'x', 'food', 1, '個', 'not_recorded', 'stored', 'user')`,
        [ids.homeA, ids.locB1],
      ),
    ).rejects.toThrow(/foreign key/)
  })
  it('数量 0 の明細はアーカイブなしでは存在できない', async () => {
    const lot = await createLot()
    await expect(db.query(`update public.inventory_lots set quantity = 0 where id = $1`, [lot.id])).rejects.toThrow(/zero_only_archived/)
  })
  it('正しい値（月精度・日精度・製造年月）は通る', async () => {
    await createLot({ expiry_value: '2030-11-08', expiry_precision: 'day' })
    await createLot({ expiry_value: null, expiry_precision: null, expiry_check: 'not_recorded', manufactured_value: '2024-05', manufactured_precision: 'month', shelf_life_months: 84 })
    expect((await snapshot()).lots).toHaveLength(2)
  })
})

describe('001 AC6：更新すると updated_at・revision が進み、イベントが残る', () => {
  it('数量の変更', async () => {
    const lot = await createLot()
    const before = await revision()
    await change({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 4 })
    const after = (await snapshot()).lots[0]!
    expect(after.quantity).toBe(4)
    expect(after.updated_at).not.toBe(lot.updated_at)
    expect(await revision()).toBeGreaterThan(before)
    const ev = await events()
    expect(ev.map((e) => e.event_type)).toEqual(['create', 'set_quantity'])
    expect(ev.every((e) => e.actor_user_id === ids.userA)).toBe(true)
  })
  it('古い updated_at での更新は拒否される（楽観ロック）', async () => {
    const lot = await createLot()
    await change({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 5 }, ids.userA2)
    await expect(change({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 3 })).rejects.toThrow(/ほかの家族が先に変更しました/)
    expect((await snapshot()).lots[0]!.quantity).toBe(5)
  })
  it('保管場所の名前・説明の編集と追加、空の場所の削除', async () => {
    const s = await snapshot()
    const loc = s.locations.find((l) => l.id === ids.locA2)!
    await change({ type: 'upsert_location', location_id: loc.id, expected_updated_at: loc.updated_at, display_name: 'Aのリュック', kind: 'go_bag', physical_note: '玄関の棚' })
    await change({ type: 'upsert_location', display_name: '新しい場所', kind: 'other', physical_note: null })
    let after = await snapshot()
    expect(after.locations.find((l) => l.id === loc.id)).toMatchObject({ display_name: 'Aのリュック', physical_note: '玄関の棚' })
    const added = after.locations.find((l) => l.display_name === '新しい場所')!
    await change({ type: 'archive_location', location_id: added.id, expected_updated_at: added.updated_at })
    after = await snapshot()
    expect(after.locations.find((l) => l.id === added.id)).toBeUndefined()
  })
  it('中身がある保管場所は削除できない', async () => {
    await createLot()
    const loc = (await snapshot()).locations.find((l) => l.id === ids.locA1)!
    await expect(change({ type: 'archive_location', location_id: loc.id, expected_updated_at: loc.updated_at })).rejects.toThrow(/中身がある/)
  })
})

describe('001 AC7：数量 0 でアーカイブされ、スナップショットから消え、記録は残る', () => {
  it('消費で 0 になる', async () => {
    const lot = await createLot()
    await change({ type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 6, disposition: 'consumed' })
    expect((await snapshot()).lots).toHaveLength(0)
    const row = await db.query<{ archive_reason: string; quantity: string }>(`select archive_reason, quantity::text from public.inventory_lots where id = $1`, [lot.id])
    expect(row.rows[0]).toEqual({ archive_reason: 'consumed', quantity: '0' })
    expect((await events()).map((e) => e.event_type)).toEqual(['create', 'consumed'])
  })
  it('一部の消費では残りが減るだけ', async () => {
    const lot = await createLot()
    await change({ type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 2, disposition: 'discarded' })
    expect((await snapshot()).lots[0]!.quantity).toBe(4)
  })
  it('残りより多くは減らせない', async () => {
    const lot = await createLot()
    await expect(change({ type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 7, disposition: 'consumed' })).rejects.toThrow(/残りの数量/)
  })
})

describe('007 AC4〜AC6・AC9：移動・買い替え・分ける・要確認', () => {
  it('一部移動で元の明細が減り、移動先に同じ品名・期限の明細ができる', async () => {
    const lot = await createLot()
    await change({ type: 'move_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, to_location_id: ids.locA2, quantity: 2 })
    const s = await snapshot()
    expect(s.lots).toHaveLength(2)
    expect(s.lots.find((l) => l.id === lot.id)!.quantity).toBe(4)
    expect(s.lots.find((l) => l.id !== lot.id)).toMatchObject({ location_id: ids.locA2, quantity: 2, name: lot.name, expiry_value: '2027-03' })
  })
  it('全部の移動は同じ明細の場所が変わる', async () => {
    const lot = await createLot()
    await change({ type: 'move_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, to_location_id: ids.locA2 })
    const s = await snapshot()
    expect(s.lots).toHaveLength(1)
    expect(s.lots[0]).toMatchObject({ id: lot.id, location_id: ids.locA2 })
  })
  it('買い替えで旧明細がアーカイブされ、新明細が別に追加される', async () => {
    const lot = await createLot()
    await change({ type: 'replace_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, disposition: 'consumed', new_lot: lotInput(ids.locA1, { expiry_value: '2032-01' }) })
    const s = await snapshot()
    expect(s.lots).toHaveLength(1)
    expect(s.lots[0]!.id).not.toBe(lot.id)
    expect(s.lots[0]!.expiry_value).toBe('2032-01')
  })
  it('買い替えの新明細が不正なら、旧明細も変わらない（原子性）', async () => {
    const lot = await createLot()
    await expect(
      change({ type: 'replace_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, disposition: 'consumed', new_lot: lotInput(ids.locA1, { expiry_value: '2032-13' }) }),
    ).rejects.toThrow()
    const s = await snapshot()
    expect(s.lots).toHaveLength(1)
    expect(s.lots[0]!.id).toBe(lot.id)
    expect((await events()).map((e) => e.event_type)).toEqual(['create'])
  })
  it('分けるで親が減り子ができる。親を超える分割はエラーで、何も変わらない', async () => {
    const lot = await createLot({ name: 'セット', quantity: 2, unit: '箱', category: 'food', liters_per_unit: null })
    await expect(
      change({ type: 'split_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, decrease: 3, children: [lotInput(ids.locA1, { name: '中身' })] }),
    ).rejects.toThrow(/残りの数量/)
    expect((await snapshot()).lots).toHaveLength(1)
    await change({ type: 'split_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, decrease: 1, children: [lotInput(ids.locA1, { name: '中身A', quantity: 4, unit: '袋' }), lotInput(ids.locA1, { name: '中身B', quantity: 3, unit: '袋' })] })
    const s = await snapshot()
    expect(s.lots.find((l) => l.id === lot.id)!.quantity).toBe(1)
    expect(s.lots.filter((l) => l.name.startsWith('中身')).map((l) => l.quantity).sort()).toEqual([3, 4])
  })
  it('確認済みにすると要確認が外れ、写真由来は「確認済み」になり、メモが追記される', async () => {
    const lot = await createLot({ source: 'photo_review', needs_review: true, notes: '写真から' })
    await change({ type: 'confirm_review', lot_id: lot.id, expected_updated_at: lot.updated_at, note: '実物で確認' })
    expect((await snapshot()).lots[0]).toMatchObject({ needs_review: false, source: 'user_confirmed', notes: '写真から\n実物で確認' })
  })
  it('編集で期限を年月のまま保存し、日付を補わない', async () => {
    const lot = await createLot()
    await change({ type: 'update_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, patch: { expiry_value: '2028-08', expiry_precision: 'month', notes: '期限を更新' } })
    expect((await snapshot()).lots[0]).toMatchObject({ expiry_value: '2028-08', expiry_precision: 'month', notes: '期限を更新' })
  })
  it('編集で数量 0 にはできない', async () => {
    const lot = await createLot()
    await expect(change({ type: 'update_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, patch: { quantity: 0 } })).rejects.toThrow(/消費・廃棄/)
  })
})

describe('別の家庭の明細は変更できない', () => {
  it('家庭B のユーザーが家庭A の明細 ID を指定しても見つからない', async () => {
    const lot = await createLot()
    await expect(change({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 1 }, ids.userB)).rejects.toThrow(/見つかりません/)
    expect((await snapshot()).lots[0]!.quantity).toBe(6)
  })
})
