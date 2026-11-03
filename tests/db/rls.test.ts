import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { snapshotSchema } from '../../src/domain/schemas'
import { ANON, as, createDb, lotInput, rpc, setupHouseholds, user } from './harness'

let db: PGlite
let ids: Awaited<ReturnType<typeof setupHouseholds>>

const TABLES = ['households', 'household_members', 'storage_locations', 'inventory_lots', 'inventory_change_events']

beforeAll(async () => {
  db = await createDb()
  ids = await setupHouseholds(db)
  await rpc(db, user(ids.userA), 'apply_change', { p_change: { type: 'create_lot', lot: lotInput(ids.locA1) } })
  await rpc(db, user(ids.userB), 'apply_change', { p_change: { type: 'create_lot', lot: lotInput(ids.locB1, { name: '家庭Bの品' }) } })
}, 60_000)

describe('001 AC1：マイグレーション', () => {
  it('PGlite 上でエラーなく適用でき、全業務テーブルで RLS が有効', async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    )
    for (const t of TABLES) expect(res.rows.find((r) => r.relname === t)?.relrowsecurity, t).toBe(true)
  })
})

describe('001 AC2：未ログイン（anon）は読めない・書けない', () => {
  for (const t of TABLES) {
    it(`${t} を SELECT できない`, async () => {
      await expect(as(db, ANON, (tx) => tx.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/)
    })
  }
  it('inventory_lots に INSERT / UPDATE / DELETE できない', async () => {
    await expect(
      as(db, ANON, (tx) => tx.query(`insert into public.inventory_lots (household_id, location_id, name, category, quantity, unit, expiry_check, use_status, source) values ($1, $2, 'x', 'food', 1, '個', 'not_recorded', 'stored', 'user')`, [ids.homeA, ids.locA1])),
    ).rejects.toThrow(/permission denied/)
    await expect(as(db, ANON, (tx) => tx.query(`update public.inventory_lots set quantity = 99`))).rejects.toThrow(/permission denied/)
    await expect(as(db, ANON, (tx) => tx.query(`delete from public.inventory_lots`))).rejects.toThrow(/permission denied/)
  })
  it('スナップショット・変更の関数を呼べない', async () => {
    await expect(rpc(db, ANON, 'get_household_snapshot')).rejects.toThrow(/permission denied/)
    await expect(rpc(db, ANON, 'apply_change', { p_change: { type: 'create_lot', lot: lotInput(ids.locA1) } })).rejects.toThrow(/permission denied/)
  })
  it('ping だけは呼べる（休止防止用。業務データに触れない）', async () => {
    expect(await rpc(db, ANON, 'ping')).toBe(true)
  })
  it('内部用の関数（private スキーマ）は API から見えない', async () => {
    const res = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname like '\\_%'`)
    expect(res.rows[0]!.n).toBe(0)
    await expect(as(db, ANON, (tx) => tx.query(`select private.is_member($1)`, [ids.homeA]))).rejects.toThrow(/permission denied/)
  })
})

describe('001 AC3：別の家庭のデータは読めない・書けない', () => {
  it('家庭A のメンバーには家庭B の行が見えない', async () => {
    const rows = await as(db, user(ids.userA), async (tx) => {
      const lots = await tx.query<{ household_id: string }>(`select household_id from public.inventory_lots`)
      const locs = await tx.query<{ household_id: string }>(`select household_id from public.storage_locations`)
      const homes = await tx.query<{ id: string }>(`select id from public.households`)
      return { lots: lots.rows, locs: locs.rows, homes: homes.rows }
    })
    expect(rows.lots.length).toBeGreaterThan(0)
    expect(rows.lots.every((r) => r.household_id === ids.homeA)).toBe(true)
    expect(rows.locs.every((r) => r.household_id === ids.homeA)).toBe(true)
    expect(rows.homes).toEqual([{ id: ids.homeA }])
  })
  it('household_id を家庭B にした INSERT は拒否される', async () => {
    await expect(
      as(db, user(ids.userA), (tx) =>
        tx.query(`insert into public.storage_locations (household_id, display_name, kind) values ($1, '侵入', 'other')`, [ids.homeB]),
      ),
    ).rejects.toThrow(/row-level security/)
  })
  it('家庭B の行の UPDATE は 0 件（見えないので変えられない）', async () => {
    const n = await as(db, user(ids.userA), async (tx) => {
      const r = await tx.query(`update public.inventory_lots set quantity = 999 where household_id = $1`, [ids.homeB])
      return r.affectedRows
    })
    expect(n).toBe(0)
    const check = await db.query<{ q: string }>(`select quantity::text as q from public.inventory_lots where household_id = $1`, [ids.homeB])
    expect(check.rows[0]!.q).toBe('6')
  })
  it('自分の家庭の明細を家庭B に付け替えることはできない', async () => {
    await expect(
      as(db, user(ids.userA), (tx) => tx.query(`update public.inventory_lots set household_id = $1 where household_id = $2`, [ids.homeB, ids.homeA])),
    ).rejects.toThrow(/row-level security|violates foreign key/)
  })
  it('家庭B の保管場所を指定した明細は作れない', async () => {
    await expect(
      rpc(db, user(ids.userA), 'apply_change', { p_change: { type: 'create_lot', lot: lotInput(ids.locB1) } }),
    ).rejects.toThrow(/保管場所が見つかりません/)
  })
  it('家庭に属していない人はスナップショットを取れない', async () => {
    await expect(rpc(db, user(ids.outsider), 'get_household_snapshot')).rejects.toThrow(/家庭に所属していません/)
  })
  it('家庭B を指定してスナップショットを取ろうとしても拒否される', async () => {
    await expect(rpc(db, user(ids.userA), 'get_household_snapshot', { p_household_id: ids.homeB })).rejects.toThrow(/メンバーではありません/)
  })
  it('監査イベントを消せない・書き換えられない', async () => {
    await expect(as(db, user(ids.userA), (tx) => tx.query(`delete from public.inventory_change_events`))).rejects.toThrow(/permission denied/)
    await expect(as(db, user(ids.userA), (tx) => tx.query(`update public.inventory_change_events set event_type = 'x'`))).rejects.toThrow(/permission denied/)
  })
  it('明細を DELETE できない（消費・廃棄はアーカイブで行う）', async () => {
    await expect(as(db, user(ids.userA), (tx) => tx.query(`delete from public.inventory_lots`))).rejects.toThrow(/permission denied/)
  })
})

describe('001 AC4：スナップショット', () => {
  it('1回の呼び出しで、画面側の検証に通る形で返る', async () => {
    const snap = await rpc(db, user(ids.userA), 'get_household_snapshot')
    const parsed = snapshotSchema.safeParse(snap)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(parsed.data!.household_id).toBe(ids.homeA)
    expect(parsed.data!.locations).toHaveLength(2)
    expect(parsed.data!.lots.every((l) => l.location_id === ids.locA1 || l.location_id === ids.locA2)).toBe(true)
  })
})
