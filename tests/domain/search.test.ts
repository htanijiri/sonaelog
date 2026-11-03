import { describe, expect, it } from 'vitest'
import { filterFromParams, filterItems, normalizeText, paramsFromFilter } from '../../src/domain/search'
import { shelfLifeSuggestions } from '../../src/domain/shelfLifePresets'
import { sampleSnapshot, TODAY } from './helpers'

const snap = sampleSnapshot()
const names = (q: string) => filterItems(snap, { q }, TODAY).map((r) => r.lot.name)

describe('006 AC1：検索', () => {
  it('正規化：全角・半角、カタカナ・ひらがな、大文字・小文字を同一視する', () => {
    expect(normalizeText('ＬＥＤライト')).toBe(normalizeText('ledらいと'))
    expect(normalizeText('ｸﾗｯｶｰ')).toBe(normalizeText('くらっかー'))
    expect(normalizeText('単３')).toBe(normalizeText('単3'))
  })
  it('品名の部分一致', () => {
    expect(names('単3')).toEqual(['見本の単3形乾電池'])
    expect(names('単３')).toEqual(['見本の単3形乾電池'])
  })
  it('メモも検索対象', () => {
    expect(names('生活用水候補')).toContain('見本の山の湧き水 2L')
  })
  it('かなで検索してもカタカナの品名が見つかる', () => {
    expect(names('くらっかー')).toHaveLength(3)
  })
  it('複数の語は AND で絞る', () => {
    expect(names('保存水 2L')).toEqual(['見本の保存水 2L（期限切れ）'])
  })
  it('006 AC3：同名の品が複数の保管場所にあれば場所ごとに出る（まとめない）', () => {
    const r = filterItems(snap, { q: 'クラッカー' }, TODAY)
    expect(new Set(r.map((x) => x.location!.id)).size).toBe(3)
  })
  it('同名で期限違いの品は別の行で、期限が近い順に隣り合う', () => {
    const r = filterItems(snap, { q: '湧き水' }, TODAY)
    expect(r.map((x) => [x.lot.expiry_value, x.expiry.status])).toEqual([
      ['2025-11', 'expired'],
      ['2027-03', 'within_1_year'],
    ])
  })
  it('絞り込み：期限の状態・管理の状態・カテゴリ・場所・要確認', () => {
    expect(filterItems(snap, { expiry: 'expired' }, TODAY)).toHaveLength(3)
    expect(filterItems(snap, { useStatus: 'replacement_planned' }, TODAY).map((r) => r.lot.name)).toEqual(['見本の缶入りパン'])
    expect(filterItems(snap, { category: 'water' }, TODAY).every((r) => r.lot.category === 'water')).toBe(true)
    expect(filterItems(snap, { review: true }, TODAY)).toHaveLength(8)
    const g01 = snap.locations.find((l) => l.seed_code === 'G01')!
    expect(filterItems(snap, { location: g01.id }, TODAY)).toHaveLength(4)
  })
  it('期限が近い順：日付のあるものが先、分からないものは後ろ', () => {
    const r = filterItems(snap, { sort: 'expiry' }, TODAY)
    const firstUnknown = r.findIndex((x) => x.expiry.endDate === null)
    expect(r.slice(firstUnknown).every((x) => x.expiry.endDate === null)).toBe(true)
    expect(r[0]!.lot.expiry_value).toBe('2024-02')
  })
  it('URL のクエリと絞り込み条件を相互に変換できる', () => {
    const f = { q: '水', expiry: 'expired' as const, review: true as const, sort: 'name' as const }
    expect(filterFromParams(paramsFromFilter(f))).toMatchObject(f)
  })
})

describe('007：「製造から○年」の候補', () => {
  it('固定の候補に、同じ品名の明細で使った年数を加える', () => {
    const s = shelfLifeSuggestions('見本のカセットガス', snap.lots)
    expect(s.map((x) => x.months)).toEqual([84, 84])
    expect(s[1]!.label).toContain('見本のカセットガス')
    expect(shelfLifeSuggestions('別の品', snap.lots)).toEqual([{ label: 'カセットガス', months: 84 }])
  })
})
