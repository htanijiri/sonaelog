import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { seedPayload, validateSeed } from '../../src/domain/seed'
import type { Snapshot } from '../../src/domain/types'
import { createDb, rpc, SERVICE, user } from './harness'

const payload = () => seedPayload(validateSeed(JSON.parse(readFileSync('fixtures/sample-data.json', 'utf8'))).data!)
const USER = '44444444-4444-4444-8444-444444444444'

describe('002 AC4/AC6：初期データの投入（seed_household）', () => {
  it('2回実行しても二重登録せず、運用中の修正を上書きしない', async () => {
    const db = await createDb()
    const first = await rpc<Record<string, number | string>>(db, SERVICE, 'seed_household', { p_seed_key: 'initial', p_name: '見本の家', p_payload: payload() })
    expect(first).toMatchObject({ locations_inserted: 11, lots_inserted: 32, lots_skipped: 0 })

    await db.exec(`insert into auth.users (id) values ('${USER}');
      insert into public.household_members (household_id, user_id) values ('${first.household_id}', '${USER}');`)
    let snap = await rpc<Snapshot>(db, user(USER), 'get_household_snapshot')
    expect(snap.lots).toHaveLength(32)
    expect(snap.lots.filter((l) => l.source === 'photo_review').every((l) => typeof l.needs_review === 'boolean')).toBe(true)

    // アプリ経由で数量と保管場所の説明を変える
    const lot = snap.lots.find((l) => l.seed_code === 'T0001')!
    const loc = snap.locations.find((l) => l.seed_code === 'L01')!
    await rpc(db, user(USER), 'apply_change', { p_change: { type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 30 } })
    await rpc(db, user(USER), 'apply_change', { p_change: { type: 'upsert_location', location_id: loc.id, expected_updated_at: loc.updated_at, display_name: loc.display_name, kind: loc.kind, physical_note: '2階の押し入れ' } })

    const second = await rpc<Record<string, number>>(db, SERVICE, 'seed_household', { p_seed_key: 'initial', p_name: '見本の家', p_payload: payload() })
    expect(second).toMatchObject({ locations_inserted: 0, locations_skipped: 11, lots_inserted: 0, lots_skipped: 32 })

    snap = await rpc<Snapshot>(db, user(USER), 'get_household_snapshot')
    expect(snap.lots).toHaveLength(32)
    expect(snap.lots.find((l) => l.seed_code === 'T0001')!.quantity).toBe(30)
    expect(snap.locations.find((l) => l.seed_code === 'L01')!.physical_note).toBe('2階の押し入れ')
  })

  it('一般のユーザーは seed_household を呼べない', async () => {
    const db = await createDb()
    await db.exec(`insert into auth.users (id) values ('${USER}')`)
    await expect(rpc(db, user(USER), 'seed_household', { p_seed_key: 'x', p_name: 'x', p_payload: payload() })).rejects.toThrow(/permission denied/)
  })

  it('日付のない明細に日付が入らない・カテゴリがそのまま入る', async () => {
    const db = await createDb()
    const r = await rpc<{ household_id: string }>(db, SERVICE, 'seed_household', { p_seed_key: 'initial', p_name: '見本の家', p_payload: payload() })
    const rows = await db.query<{ seed_code: string; expiry_value: string | null; category: string }>(
      `select seed_code, expiry_value, category from public.inventory_lots where household_id = $1 order by seed_code`,
      [r.household_id],
    )
    expect(rows.rows.find((x) => x.seed_code === 'T0001')!.expiry_value).toBeNull()
    expect(rows.rows.find((x) => x.seed_code === 'T0029')!.category).toBe('unknown')
  })
})
