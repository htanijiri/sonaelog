// 疑似クラウドが使う変更ロジック（TypeScript 版）。SQL 版（tests/db/changes.test.ts）と同じ規則か確かめる
import { describe, expect, it } from 'vitest'
import { applyChangeToState, ChangeError, stateToSnapshot, type HouseholdState } from '../../src/domain/changes'
import type { LotInput } from '../../src/domain/types'
import { sampleSnapshot } from './helpers'

function state(): HouseholdState {
  const s = sampleSnapshot()
  return {
    household_id: 'h',
    household_name: '見本',
    revision: 1,
    locations: s.locations.map((l) => ({ ...l, archived_at: null })),
    lots: s.lots.map((l) => ({ ...l, archived_at: null, archive_reason: null })),
    events: [],
  }
}
let clock = 0
const ctx = () => ({ actor: 'u', now: new Date(Date.UTC(2026, 10, 3, 0, 0, ++clock)).toISOString(), newId: () => `new-${++clock}` })
const input = (s: HouseholdState, patch: Partial<LotInput> = {}): LotInput => {
  const { id: _i, seed_code: _s, created_at: _c, updated_at: _u, archived_at: _a, archive_reason: _r, ...rest } = s.lots[0]!
  return { ...rest, ...patch }
}

describe('変更ロジック（疑似クラウド）', () => {
  it('消費で 0 になるとスナップショットから消え、イベントが残る', () => {
    const s = state()
    const lot = s.lots[0]!
    applyChangeToState(s, { type: 'consume', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: lot.quantity, disposition: 'consumed' }, ctx())
    expect(stateToSnapshot(s, 'x').lots.find((l) => l.id === lot.id)).toBeUndefined()
    expect(s.events.map((e) => e.event_type)).toEqual(['consumed'])
    expect(s.revision).toBe(2)
  })
  it('楽観ロック：古い updated_at は conflict', () => {
    const s = state()
    const lot = s.lots[0]!
    const old = lot.updated_at
    applyChangeToState(s, { type: 'set_quantity', lot_id: lot.id, expected_updated_at: old, quantity: 3 }, ctx())
    expect(() => applyChangeToState(s, { type: 'set_quantity', lot_id: lot.id, expected_updated_at: old, quantity: 9 }, ctx())).toThrow(ChangeError)
    expect(lot.quantity).toBe(3)
  })
  it('買い替えの新明細が不正なら何も変わらない（原子性）', () => {
    const s = state()
    const lot = s.lots[0]!
    const before = JSON.stringify(s)
    expect(() =>
      applyChangeToState(s, { type: 'replace_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, disposition: 'consumed', new_lot: input(s, { expiry_value: '2030-13', expiry_precision: 'month', expiry_check: 'exact_or_month_known' }) }, ctx()),
    ).toThrow(ChangeError)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('一部移動で別の明細ができる', () => {
    const s = state()
    const lot = s.lots[0]!
    const to = s.locations[1]!.id
    applyChangeToState(s, { type: 'move_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, to_location_id: to, quantity: 4 }, ctx())
    expect(lot.quantity).toBe(20)
    expect(s.lots.find((l) => l.location_id === to && l.name === lot.name)!.quantity).toBe(4)
  })
  it('分けるで親を超えるとエラーで何も変わらない', () => {
    const s = state()
    const lot = s.lots[0]!
    const before = JSON.stringify(s)
    expect(() => applyChangeToState(s, { type: 'split_lot', lot_id: lot.id, expected_updated_at: lot.updated_at, decrease: 999, children: [input(s)] }, ctx())).toThrow(/残りの数量/)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('確認済みにすると写真由来は user_confirmed になる', () => {
    const s = state()
    const lot = s.lots.find((l) => l.source === 'photo_review')!
    applyChangeToState(s, { type: 'confirm_review', lot_id: lot.id, expected_updated_at: lot.updated_at, note: '確認' }, ctx())
    expect(lot).toMatchObject({ needs_review: false, source: 'user_confirmed' })
    expect(lot.notes.endsWith('確認')).toBe(true)
  })
  it('中身がある保管場所は削除できない', () => {
    const s = state()
    const loc = s.locations[0]!
    expect(() => applyChangeToState(s, { type: 'archive_location', location_id: loc.id, expected_updated_at: loc.updated_at }, ctx())).toThrow(/中身がある/)
  })
})
