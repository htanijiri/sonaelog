// spec 010：食料品の味の感想のドメインロジック（正規化キー・変更・検索・書き出し・古いスナップショット）
import { describe, expect, it } from 'vitest'
import { applyChangeToState, ChangeError, stateToSnapshot, type HouseholdState } from '../../src/domain/changes'
import { exportCsv, exportJson } from '../../src/domain/exportData'
import { foodNameKey, reviewRows } from '../../src/domain/foodReviews'
import { snapshotSchema } from '../../src/domain/schemas'
import { filterItems } from '../../src/domain/search'
import type { FoodReview } from '../../src/domain/types'
import { migrateStored } from '../../src/local/snapshotStore'
import { sampleSnapshot, TODAY } from './helpers'

function state(): HouseholdState {
  const s = sampleSnapshot()
  return {
    household_id: 'h',
    household_name: '見本',
    revision: 1,
    locations: s.locations.map((l) => ({ ...l, archived_at: null })),
    lots: s.lots.map((l) => ({ ...l, archived_at: null, archive_reason: null })),
    food_reviews: [],
    events: [],
  }
}
let clock = 0
const ctx = () => ({ actor: 'u', now: new Date(Date.UTC(2026, 10, 19, 0, 0, ++clock)).toISOString(), newId: () => `new-${++clock}` })
const set = (s: HouseholdState, name: string, rating: FoodReview['rating'], comment: string, expected: string | null = null) =>
  applyChangeToState(s, { type: 'set_food_review', name, rating, comment, expected_updated_at: expected }, ctx())
const conflict = (fn: () => void) => {
  try {
    fn()
  } catch (e) {
    return (e as ChangeError).code
  }
  return 'no error'
}

describe('010 AC3：品名の正規化キー', () => {
  it('全角・半角、前後・連続する空白を揃える', () => {
    expect(foodNameKey('ＡＢＣ　 ご飯 ')).toBe('ABC ご飯')
    expect(foodNameKey('ｶﾚｰ')).toBe('カレー')
    expect(foodNameKey('  見本\tカレー  ')).toBe('見本 カレー')
  })
})

describe('010 AC2・AC4・AC5：変更の規則（疑似クラウドが使う TypeScript 版）', () => {
  it('作成・更新・削除、監査イベントと revision', () => {
    const s = state()
    set(s, '見本のクラッカー保存缶', 'again', ' 塩味がちょうどよい ')
    expect(s.food_reviews).toHaveLength(1)
    expect(s.food_reviews[0]).toMatchObject({ name_key: '見本のクラッカー保存缶', rating: 'again', comment: '塩味がちょうどよい', updated_by: 'u' })
    const rev = s.revision
    set(s, '見本のクラッカー保存缶', 'ok', '', s.food_reviews[0]!.updated_at)
    expect(s.food_reviews[0]!.rating).toBe('ok')
    set(s, '見本のクラッカー保存缶', null, ' ', s.food_reviews[0]!.updated_at)
    expect(s.food_reviews).toEqual([])
    expect(s.revision).toBe(rev + 2)
    expect(s.events.map((e) => e.event_type)).toEqual(['food_review_create', 'food_review_update', 'food_review_delete'])
  })
  it('楽観ロック：新規のつもりで既にある・古い updated_at・ないのに expected あり', () => {
    const s = state()
    set(s, '見本のおかゆ', 'never', '')
    const old = s.food_reviews[0]!.updated_at
    expect(conflict(() => set(s, '見本のおかゆ', 'ok', ''))).toBe('conflict')
    set(s, '見本のおかゆ', 'ok', '', old)
    expect(conflict(() => set(s, '見本のおかゆ', 'again', '', old))).toBe('conflict')
    expect(conflict(() => set(s, '見本の缶入りパン', 'again', '', old))).toBe('conflict')
  })
  it('食料品の在庫にない品名・食料品以外には書けない。値の制限', () => {
    const s = state()
    expect(conflict(() => set(s, 'どこにもない品', 'ok', ''))).toBe('validation')
    expect(conflict(() => set(s, '見本のカセットガス', 'ok', ''))).toBe('validation')
    expect(conflict(() => set(s, '見本のおかゆ', 'great' as never, ''))).toBe('validation')
    expect(conflict(() => set(s, '見本のおかゆ', null, 'あ'.repeat(501)))).toBe('validation')
    expect(s.food_reviews).toEqual([])
    expect(s.revision).toBe(1)
  })
  it('空の感想は作らず、revision も変えない', () => {
    const s = state()
    set(s, '見本のおかゆ', null, '')
    expect(s.food_reviews).toEqual([])
    expect(s.revision).toBe(1)
  })
  it('明細を食べ切っても感想は残り、スナップショットに出る', () => {
    const s = state()
    set(s, '見本のおかゆ', 'again', '')
    const lot = s.lots.find((l) => l.name === '見本のおかゆ')!
    applyChangeToState(s, { type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: lot.quantity, disposition: 'consumed' }, ctx())
    const snap = stateToSnapshot(s, 'x')
    expect(snap.lots.some((l) => l.name === '見本のおかゆ')).toBe(false)
    expect(snap.food_reviews).toHaveLength(1)
    const rows = reviewRows(snap)
    expect(rows[0]!.stock).toEqual([])
  })
})

function withReviews() {
  const s = state()
  set(s, '見本のクラッカー保存缶', 'again', '塩味がちょうどよい')
  set(s, '見本の缶入りパン', 'never', 'パサパサ')
  return stateToSnapshot(s, 'x')
}

describe('010 AC10：検索', () => {
  it('感想のコメント・評価の表示名で食料品が見つかり、同じ品名の明細すべてに感想が付く', () => {
    const snap = withReviews()
    const rows = filterItems(snap, { q: 'しおあじ' }, TODAY)
    // ひらがな・カタカナの違いは normalizeText が吸収するが、漢字の「塩味」はかなでは引けない
    expect(rows).toHaveLength(0)
    const hit = filterItems(snap, { q: '塩味' }, TODAY)
    expect(hit.map((r) => r.lot.name)).toEqual(['見本のクラッカー保存缶', '見本のクラッカー保存缶', '見本のクラッカー保存缶'])
    expect(hit.every((r) => r.foodReview?.rating === 'again')).toBe(true)
    expect(filterItems(snap, { q: 'もう買わない' }, TODAY).map((r) => r.lot.name)).toEqual(['見本の缶入りパン'])
  })
  it('食料品以外の行には感想が付かない', () => {
    const snap = withReviews()
    const rows = filterItems(snap, {}, TODAY)
    expect(rows.filter((r) => r.foodReview).every((r) => r.lot.category === 'food')).toBe(true)
  })
})

describe('010 AC9：味の感想の画面の行', () => {
  it('評価の順 → 品名の順、在庫数は単位ごと', () => {
    const s = state()
    set(s, '見本のおかゆ', null, 'メモだけ')
    set(s, '見本の缶入りパン', 'never', '')
    set(s, '見本のクラッカー保存缶', 'again', '')
    set(s, '見本のパックご飯', 'ok', '')
    const rows = reviewRows(stateToSnapshot(s, 'x'))
    expect(rows.map((r) => r.review.display_name)).toEqual(['見本のクラッカー保存缶', '見本のパックご飯', '見本の缶入りパン', '見本のおかゆ'])
    expect(rows[0]!.stock).toEqual([{ unit: '缶', quantity: 4 }])
  })
})

describe('010 AC12：書き出し', () => {
  it('JSON に food_reviews、CSV に味の評価・味の感想の列', () => {
    const snap = withReviews()
    const j = JSON.parse(exportJson(snap, 'x'))
    expect(j.food_reviews).toHaveLength(2)
    const csv = exportCsv(snap, TODAY)
    expect(csv.split('\r\n')[0]).toContain('メモ,味の評価,味の感想,セット内訳')
    const line = csv.split('\r\n').find((l) => l.includes('見本の缶入りパン'))!
    expect(line).toContain(',もう買わない,パサパサ,')
  })
})

describe('010 AC6：food_reviews のない古いスナップショット', () => {
  it('スキーマは空として読み込む', () => {
    const { food_reviews: _f, ...old } = sampleSnapshot()
    const parsed = snapshotSchema.parse(old)
    expect(parsed.food_reviews).toEqual([])
  })
  it('端末内の保存分（形式 2）も空として読み込める', () => {
    const { food_reviews: _f, ...old } = sampleSnapshot()
    const stored = migrateStored({ key: 'k', localFormat: 2, userId: 'u', householdId: 'h', syncedAt: 'x', snapshot: old })
    expect(stored?.snapshot.food_reviews).toEqual([])
  })
})
