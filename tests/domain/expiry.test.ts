import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { todayInTokyo, type PlainDate } from '../../src/domain/dates'
import { effectiveExpiry, expiryInfo, formatExpiry } from '../../src/domain/expiry'
import { seedToRows, validateSeed } from '../../src/domain/seed'
import { summarize } from '../../src/domain/summary'
import type { InventoryLot, Snapshot } from '../../src/domain/types'

const D = (s: string): PlainDate => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}
const TODAY = D('2026-11-03')

type Fields = Parameters<typeof expiryInfo>[0]
const lot = (patch: Partial<Fields>): Fields => ({
  expiry_value: null,
  expiry_precision: null,
  expiry_check: 'not_recorded',
  manufactured_value: null,
  manufactured_precision: null,
  shelf_life_months: null,
  ...patch,
})
const month = (v: string) => lot({ expiry_value: v, expiry_precision: 'month', expiry_check: 'exact_or_month_known' })
const day = (v: string) => lot({ expiry_value: v, expiry_precision: 'day', expiry_check: 'exact_or_month_known' })

describe('003 AC1：期限の状態（2026-11-03 時点）', () => {
  it.each([
    ['2027-08（月）は 1年以内（期限切れではない）', month('2027-08'), 'within_1_year'],
    ['2026-08（月）は期限切れ', month('2026-08'), 'expired'],
    ['2025-11（月）は期限切れ', month('2025-11'), 'expired'],
    ['2027-03（月）は 1年以内', month('2027-03'), 'within_1_year'],
    ['2030-11-08（日）は期限内', day('2030-11-08'), 'ok'],
  ])('%s', (_label, l, status) => {
    expect(expiryInfo(l, TODAY).status).toBe(status)
  })
})

describe('003 AC2：月単位の期限は月末まで有効', () => {
  it('2026-11（月）は 11/30 では期限切れでなく、12/1 で期限切れ', () => {
    expect(expiryInfo(month('2026-11'), D('2026-11-30')).status).not.toBe('expired')
    expect(expiryInfo(month('2026-11'), D('2026-11-30')).daysLeft).toBe(0)
    expect(expiryInfo(month('2026-11'), D('2026-12-01')).status).toBe('expired')
  })
  it('うるう年の 2 月末', () => {
    expect(expiryInfo(month('2028-02'), D('2028-02-29')).status).not.toBe('expired')
    expect(expiryInfo(month('2028-02'), D('2028-03-01')).status).toBe('expired')
  })
})

describe('003 AC3：3か月の境界', () => {
  it('2026-11-03 から見て 2027-02-03 は 3か月以内、2027-02-04 は 1年以内', () => {
    expect(expiryInfo(day('2027-02-03'), TODAY).status).toBe('within_3_months')
    expect(expiryInfo(day('2027-02-04'), TODAY).status).toBe('within_1_year')
  })
  it('1年の境界：2027-11-03 は 1年以内、2027-11-04 は期限内', () => {
    expect(expiryInfo(day('2027-11-03'), TODAY).status).toBe('within_1_year')
    expect(expiryInfo(day('2027-11-04'), TODAY).status).toBe('ok')
  })
  it('当日はまだ期限切れではない', () => {
    expect(expiryInfo(day('2026-11-03'), TODAY).status).toBe('within_3_months')
    expect(expiryInfo(day('2026-11-02'), TODAY).status).toBe('expired')
  })
})

describe('003 AC4：日付が分からないものは専用の状態で、残り日数を出さない', () => {
  it.each([
    ['not_recorded', 'unknown'],
    ['reported_no_expiry_issue_exact_unknown', 'reported_ok_date_unknown'],
    ['reported_within_one_year_exact_unknown', 'within_1_year_date_unknown'],
  ] as const)('%s → %s', (check, status) => {
    const info = expiryInfo(lot({ expiry_check: check }), TODAY)
    expect(info.status).toBe(status)
    expect(info.daysLeft).toBeNull()
    expect(info.endDate).toBeNull()
  })
  it('表示は「未確認」で、日付を出さない', () => {
    expect(formatExpiry(lot({})).text).toBe('未確認')
  })
})

describe('003 AC5：「今日」は Asia/Tokyo で決まる', () => {
  it('UTC 2026-11-03T16:00 は日本時間で 11/4', () => {
    expect(todayInTokyo(new Date('2026-11-03T16:00:00Z'))).toEqual(D('2026-11-04'))
    expect(todayInTokyo(new Date('2026-11-03T14:59:59Z'))).toEqual(D('2026-11-03'))
  })
  it('端末のタイムゾーン（process.env.TZ）を変えても同じ', async () => {
    const { execFileSync } = await import('node:child_process')
    const code = `import { todayInTokyo } from './src/domain/dates.ts'; console.log(JSON.stringify(todayInTokyo(new Date('2026-11-03T16:00:00Z'))))`
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const out = execFileSync('npx', ['tsx', '-e', code], { env: { ...process.env, TZ: tz } }).toString().trim()
      expect(JSON.parse(out), tz).toEqual(D('2026-11-04'))
    }
  }, 60_000)
})

describe('003 AC11：製造年月から期限を計算する', () => {
  const mfg = (v: string, p: 'day' | 'month', months: number | null, extra: Partial<Fields> = {}) =>
    lot({ manufactured_value: v, manufactured_precision: p, shelf_life_months: months, ...extra })

  it('製造 2024-05（月）＋84か月 → 2031-05（月）、計算した期限として扱う', () => {
    expect(effectiveExpiry(mfg('2024-05', 'month', 84))).toEqual({ value: '2031-05', precision: 'month', source: 'computed' })
    expect(expiryInfo(mfg('2024-05', 'month', 84), TODAY).status).toBe('ok')
    expect(formatExpiry(mfg('2024-05', 'month', 84))).toEqual({ text: '2031年5月', note: '製造2024年5月から7年で計算' })
  })
  it('2024-02-29（日）＋12か月 → 2025-02-28', () => {
    expect(effectiveExpiry(mfg('2024-02-29', 'day', 12))?.value).toBe('2025-02-28')
  })
  it('印字の期限があればそちらを優先する', () => {
    const l = mfg('2024-05', 'month', 84, { expiry_value: '2029-01', expiry_precision: 'month', expiry_check: 'exact_or_month_known' })
    expect(effectiveExpiry(l)).toEqual({ value: '2029-01', precision: 'month', source: 'printed' })
  })
  it('片方だけでは計算しない', () => {
    expect(effectiveExpiry(mfg('2024-05', 'month', null))).toBeNull()
    expect(effectiveExpiry(lot({ shelf_life_months: 84 }))).toBeNull()
    expect(expiryInfo(mfg('2024-05', 'month', null), TODAY).status).toBe('unknown')
  })
  it('計算した期限が過ぎていれば期限切れ', () => {
    expect(expiryInfo(mfg('2019-05', 'month', 84), TODAY).status).toBe('expired')
  })
})

// ---- 集計 ----

function sampleSnapshot(): Snapshot {
  const data = validateSeed(JSON.parse(readFileSync('fixtures/sample-data.json', 'utf8'))).data!
  let n = 0
  const { locations, lots } = seedToRows(data, () => `id-${++n}`, '2026-11-03T00:00:00Z')
  return { format: 'sonaelog-snapshot', version: 1, household_id: 'h', household_name: '見本', revision: 1, captured_at: '', locations, lots }
}
const bySeed = (s: Snapshot, code: string) => s.lots.find((l) => l.seed_code === code)!

describe('003 集計（見本データ、2026-11-03）', () => {
  const snap = sampleSnapshot()
  const s = summarize(snap, TODAY)

  it('AC6：水は容量が分かる明細だけ、飲用・期限未記録・生活用水候補に分ける', () => {
    // 手計算：飲用 = 500ml×4(未記録) + 500ml×12 + 2L×6(2027-03) + 500ml×1 + 500ml×2 + 500ml×2 + 12L×3(未記録)
    //   = 2 + 6 + 12 + 0.5 + 1 + 1 + 36 = 58.5L、うち期限未記録 = 2 + 0.5 + 1 + 1 + 36 = 40.5L
    // 生活用水候補 = 2L×6(2025-11) + 2L×2(2024-02) = 16L
    expect(s.water).toEqual({ totalLiters: 74.5, drinkingLiters: 58.5, drinkingUndatedLiters: 40.5, nonDrinkingLiters: 16, unknownVolumeLots: 0 })
  })
  it('AC6：容量の分からない水は合計に入らず件数だけ', () => {
    const copy = structuredClone(snap)
    bySeed(copy, 'T0006').liters_per_unit = null
    const t = summarize(copy, TODAY)
    expect(t.water.unknownVolumeLots).toBe(1)
    expect(t.water.totalLiters).toBe(72.5)
  })
  it('AC7：食数は単位が「食」のものだけ。セットの内訳は足さない', () => {
    // 保存ご飯 5 + 3 + パックご飯 10 = 18食。セット（箱）・パスタソース（人前）などは換算しない
    expect(s.meals.count).toBe(18)
    expect(s.meals.expiredCount).toBe(0)
    const foodLots = snap.lots.filter((l) => l.category === 'food')
    expect(s.meals.notConvertedLots).toBe(foodLots.filter((l) => l.unit !== '食').length)
  })
  it('AC8：トイレは公称回数が入力されたものだけ。未入力は件数', () => {
    // 非常用トイレ袋 1セット×10回 = 10回。簡易トイレ 20回分（品名のみ）・携帯トイレは未入力
    expect(s.toilet).toEqual({ uses: 10, missingLots: 2 })
  })
  it('AC9：明細数と単位ごとの数量を分け、単位の違う数を足さない', () => {
    expect(s.lotCount).toBe(32)
    expect(s.quantityByUnit['本']).toBe(24 + 6 + 4 + 3 + 12 + 6 + 6 + 2 + 1 + 2 + 2 + 3)
    expect(s.quantityByUnit['食']).toBe(18)
    expect(Object.keys(s.quantityByUnit)).toContain('箱')
  })
  it('期限別の件数', () => {
    expect(s.byExpiry.expired).toBe(3)
    expect(s.byExpiry.within_1_year).toBe(2)
    expect(s.byExpiry.within_1_year_date_unknown).toBe(2)
    expect(s.byExpiry.reported_ok_date_unknown).toBe(3)
    expect(s.needsReview).toBe(8)
    expect(s.byKind).toEqual({ long_term: 16, go_bag: 12, rolling: 3, pending_consumption: 1, other: 0 })
  })
  it('期限切れでも管理の状態は書き換えない（買い替え予定はそのまま）', () => {
    const bread = bySeed(snap, 'T0013') as InventoryLot
    expect(bread.use_status).toBe('replacement_planned')
    expect(expiryInfo(bread, TODAY).status).toBe('within_1_year')
  })
})
