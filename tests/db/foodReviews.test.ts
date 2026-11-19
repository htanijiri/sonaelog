// spec 010：食料品の味の感想（food_reviews）の RLS・RPC・正規化キー・楽観ロック
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../../src/domain/types'
import { foodNameKey } from '../../src/domain/foodReviews'
import { ANON, as, createDb, lotInput, rpc, setupHouseholds, user } from './harness'

let db: PGlite
let ids: Awaited<ReturnType<typeof setupHouseholds>>

beforeEach(async () => {
  db = await createDb()
  ids = await setupHouseholds(db)
}, 60_000)

const snapshot = (who = ids.userA) => rpc<Snapshot>(db, user(who), 'get_household_snapshot')
const change = (c: Record<string, unknown>, who = ids.userA) => rpc(db, user(who), 'apply_change', { p_change: c })
const food = (name: string, patch: Record<string, unknown> = {}) =>
  change({ type: 'create_lot', lot: lotInput(ids.locA1, { name, category: 'food', unit: '食', liters_per_unit: null, ...patch }) })
const review = (name: string, rating: string | null, comment: string, expected: string | null = null, who = ids.userA) =>
  change({ type: 'set_food_review', name, rating, comment, expected_updated_at: expected }, who)
const revision = async () =>
  Number((await db.query<{ revision: string }>(`select revision::text from public.households where id = $1`, [ids.homeA])).rows[0]!.revision)

describe('010 AC1：家庭のメンバーだけが読める・書ける', () => {
  it('anon はテーブルも RPC も使えない', async () => {
    await expect(as(db, ANON, (tx) => tx.query(`select * from public.food_reviews`))).rejects.toThrow(/permission denied/)
    await expect(rpc(db, ANON, 'apply_change', { p_change: { type: 'set_food_review', name: 'x', rating: 'ok', comment: '' } })).rejects.toThrow(
      /permission denied/,
    )
  })
  it('別の家庭の感想は読めず、スナップショットにも出ない', async () => {
    await food('見本 五目ごはん')
    await review('見本 五目ごはん', 'again', 'おいしい')
    const rows = await as(db, user(ids.userB), (tx) => tx.query(`select * from public.food_reviews`))
    expect(rows.rows).toHaveLength(0)
    expect((await snapshot(ids.userB)).food_reviews).toEqual([])
  })
  it('非メンバーは書けない', async () => {
    await food('見本 五目ごはん')
    await expect(review('見本 五目ごはん', 'ok', '', null, ids.outsider)).rejects.toThrow(/家庭に所属していません/)
  })
  it('直接 INSERT で別の家庭に書くことはできない（RLS）', async () => {
    await expect(
      as(db, user(ids.userB), (tx) =>
        tx.query(`insert into public.food_reviews (household_id, name_key, display_name, rating) values ($1, 'x', 'x', 'ok')`, [ids.homeA]),
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('010 AC2：作成・更新・削除と監査・revision', () => {
  it('作成すると同じ家庭の別の大人のスナップショットにも出る', async () => {
    await food('見本 五目ごはん')
    const before = await revision()
    await review('見本 五目ごはん', 'again', '子どもも完食')
    expect(await revision()).toBe(before + 1)
    const s = await snapshot(ids.userA2)
    expect(s.food_reviews).toHaveLength(1)
    expect(s.food_reviews![0]).toMatchObject({ display_name: '見本 五目ごはん', rating: 'again', comment: '子どもも完食', updated_by: ids.userA })
    expect(s.food_reviews![0]).not.toHaveProperty('household_id')
  })
  it('更新・削除（評価もコメントも空）ができ、監査イベントが残る', async () => {
    await food('見本 五目ごはん')
    await review('見本 五目ごはん', 'ok', '')
    let r = (await snapshot()).food_reviews![0]!
    await review('見本 五目ごはん', 'never', '固い', r.updated_at, ids.userA2)
    r = (await snapshot()).food_reviews![0]!
    expect(r).toMatchObject({ rating: 'never', comment: '固い', updated_by: ids.userA2 })
    const before = await revision()
    await review('見本 五目ごはん', null, '  ', r.updated_at)
    expect((await snapshot()).food_reviews).toEqual([])
    expect(await revision()).toBe(before + 1)
    const ev = await db.query<{ event_type: string; lot_id: string | null }>(
      `select event_type, lot_id from public.inventory_change_events where event_type like 'food_review%' order by occurred_at`,
    )
    expect(ev.rows.map((e) => e.event_type)).toEqual(['food_review_create', 'food_review_update', 'food_review_delete'])
    expect(ev.rows.every((e) => e.lot_id === null)).toBe(true)
  })
  it('明細を食べ切っても感想は残り、感想がある品名は在庫がなくても書き直せる', async () => {
    await food('見本 五目ごはん', { quantity: 1 })
    await review('見本 五目ごはん', 'again', '')
    const lot = (await snapshot()).lots[0]!
    await change({ type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 1, disposition: 'consumed' })
    const s = await snapshot()
    expect(s.lots).toHaveLength(0)
    expect(s.food_reviews).toHaveLength(1)
    await review('見本 五目ごはん', 'ok', '2回目は普通', s.food_reviews![0]!.updated_at)
    expect((await snapshot()).food_reviews![0]!.rating).toBe('ok')
  })
})

describe('010 AC3：品名の正規化キー', () => {
  it('全角・半角と空白の違いは同じ感想を指す', async () => {
    await food('ABC ご飯')
    await review('ＡＢＣ　 ご飯 ', 'again', '')
    const s = await snapshot()
    expect(s.food_reviews![0]!.name_key).toBe('ABC ご飯')
    // 半角の品名で更新すると同じ行が更新される（新規扱いではないので expected が必要）
    await expect(review('ABC ご飯', 'ok', '')).rejects.toThrow(/ほかの家族が先に/)
  })
  it('SQL と TypeScript のキーが一致する', async () => {
    const samples = ['ＡＢＣ　ご飯', '  見本\tカレー  ', 'ｶﾚｰ（甘口）', 'ﾊﾟﾝ  の  缶詰', '①番']
    for (const s of samples) {
      const r = await db.query<{ k: string }>(`select private.food_name_key($1) as k`, [s])
      expect(r.rows[0]!.k).toBe(foodNameKey(s))
    }
  })
})

describe('010 AC4：楽観ロック', () => {
  it('新規のつもりで既にある・古い updated_at は SL409', async () => {
    await food('見本 五目ごはん')
    await review('見本 五目ごはん', 'ok', '')
    await expect(review('見本 五目ごはん', 'again', '')).rejects.toThrow(/ほかの家族が先に/)
    const r = (await snapshot()).food_reviews![0]!
    await review('見本 五目ごはん', 'again', '', r.updated_at)
    await expect(review('見本 五目ごはん', 'never', '', r.updated_at)).rejects.toThrow(/ほかの家族が先に/)
    await expect(review('見本 カレー', 'ok', '', '2026-01-01T00:00:00Z')).rejects.toThrow(/ほかの家族が先に/)
  })
})

describe('010 AC5：書ける品名と値の制限', () => {
  it('食料品の在庫にない品名・食料品以外の品名には書けない', async () => {
    await expect(review('どこにもない品', 'ok', '')).rejects.toThrow(/食料品の在庫にない/)
    await change({ type: 'create_lot', lot: lotInput(ids.locA1, { name: '見本 水' }) })
    await expect(review('見本 水', 'ok', '')).rejects.toThrow(/食料品の在庫にない/)
  })
  it('評価は3値だけ、コメントは500文字まで', async () => {
    await food('見本 五目ごはん')
    await expect(review('見本 五目ごはん', 'great', '')).rejects.toThrow(/評価は/)
    await expect(review('見本 五目ごはん', null, 'あ'.repeat(501))).rejects.toThrow(/500文字/)
    await review('見本 五目ごはん', null, 'あ'.repeat(500))
    expect((await snapshot()).food_reviews![0]!.comment).toHaveLength(500)
  })
  it('空の感想は新規作成しない', async () => {
    await food('見本 五目ごはん')
    await review('見本 五目ごはん', null, '')
    expect((await snapshot()).food_reviews).toEqual([])
  })
})

describe('010：既存の apply_change は前段を通っても変わらない', () => {
  it('create_lot・未知の操作', async () => {
    await food('見本 五目ごはん')
    expect((await snapshot()).lots).toHaveLength(1)
    await expect(change({ type: 'unknown_op' })).rejects.toThrow(/未知の操作/)
  })
  it('内部の関数は anon から呼べない', async () => {
    await expect(as(db, ANON, (tx) => tx.query(`select private._apply_change_core('{}'::jsonb)`))).rejects.toThrow(/permission denied/)
  })
})
