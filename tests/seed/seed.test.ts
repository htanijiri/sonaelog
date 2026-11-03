import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { seedPayload, validateSeed } from '../../src/domain/seed'

const sample = () => JSON.parse(readFileSync('fixtures/sample-data.json', 'utf8'))

function broken(mutate: (d: ReturnType<typeof sample>) => void) {
  const d = sample()
  mutate(d)
  return validateSeed(d)
}

describe('002 初期データの検証', () => {
  it('見本データは検証に通る', () => {
    const r = validateSeed(sample())
    expect(r.errors).toEqual([])
    expect(r.data!.locations).toHaveLength(11)
    expect(r.data!.stock_lots).toHaveLength(32)
  })

  const cases: [string, (d: ReturnType<typeof sample>) => void, RegExp][] = [
    ['13月', (d) => Object.assign(d.stock_lots[8], { expiry: '2027-13' }), /明細 T0009 の expiry_value: 期限の形式/],
    ['存在しない日', (d) => Object.assign(d.stock_lots[8], { expiry: '2027-02-30' }), /T0009.*期限の形式/],
    ['精度と形式の不一致', (d) => Object.assign(d.stock_lots[8], { expiry_precision: 'month' }), /T0009.*期限の形式/],
    ['マイナスの数量', (d) => Object.assign(d.stock_lots[0], { quantity: -1 }), /明細 T0001 の quantity/],
    ['存在しない保管場所', (d) => Object.assign(d.stock_lots[0], { location_id: 'Z99' }), /明細 T0001: 保管場所 Z99 が存在しません/],
    ['明細 ID の重複', (d) => Object.assign(d.stock_lots[1], { id: 'T0001' }), /明細 T0001: ID が重複/],
    ['保管場所 ID の重複', (d) => Object.assign(d.locations[1], { id: 'L01' }), /保管場所 L01: ID が重複/],
    ['期限ありの確認状況なのに期限なし', (d) => Object.assign(d.stock_lots[8], { expiry: null, expiry_precision: null }), /T0009 の expiry_check/],
    ['未知の use_status', (d) => Object.assign(d.stock_lots[0], { use_status: 'lost' }), /T0001 の use_status/],
    ['未知の expiry_check', (d) => Object.assign(d.stock_lots[0], { expiry_check: 'maybe' }), /T0001 の expiry_check/],
    ['未知の source', (d) => Object.assign(d.stock_lots[0], { source: 'ai' }), /T0001 の source/],
    ['未知のカテゴリ（unknown に変えずにエラー）', (d) => Object.assign(d.stock_lots[0], { category: 'snack' }), /T0001 の category/],
    ['components の形式違反', (d) => Object.assign(d.stock_lots[14], { components: [{ name: '白米' }] }), /T0015 の components/],
    ['schema_version が 1 以外', (d) => Object.assign(d.metadata, { schema_version: 2 }), /schema_version は 1 だけ/],
  ]
  for (const [label, mutate, pattern] of cases) {
    it(`002 AC2/AC3/AC5：${label}はエラーになり、場所を示す`, () => {
      const r = broken(mutate)
      expect(r.ok).toBe(false)
      expect(r.errors.join('\n')).toMatch(pattern)
    })
  }

  it('初期データにない列は null で入る（日付を補わない）', () => {
    const r = validateSeed(sample())
    const payload = seedPayload(r.data!)
    const noExpiry = payload.lots.find((l) => l.seed_code === 'T0001')!
    expect(noExpiry).toMatchObject({ expiry_value: null, expiry_precision: null, expiry_kind: null, manufactured_value: null, uses_per_unit: null })
    expect(payload.lots.find((l) => l.seed_code === 'T0015')!.needs_review).toBe(true)
  })
})
