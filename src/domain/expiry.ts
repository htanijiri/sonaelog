// 期限の判定。端末の中で、日本時間の今日と保存済みの期限文字列だけから計算する（サーバーは呼ばない）。

import { addMonths, addMonthsToValue, compareDates, daysBetween, endOfPeriod, formatDateValue, type PlainDate } from './dates'
import type { InventoryLot, Precision } from './types'

export type ExpiryStatus =
  | 'expired'
  | 'within_3_months'
  | 'within_1_year'
  | 'ok'
  | 'within_1_year_date_unknown'
  | 'reported_ok_date_unknown'
  | 'unknown'

export interface EffectiveExpiry {
  value: string
  precision: Precision
  /** printed：印字（記録）された期限、computed：製造年月＋年数から計算した期限 */
  source: 'printed' | 'computed'
}

export interface ExpiryInfo {
  status: ExpiryStatus
  effective: EffectiveExpiry | null
  endDate: PlainDate | null
  /** 有効な最後の日まであと何日。日付が分からないときは null（「あと何日」を出さない） */
  daysLeft: number | null
}

type ExpiryFields = Pick<
  InventoryLot,
  'expiry_value' | 'expiry_precision' | 'expiry_check' | 'manufactured_value' | 'manufactured_precision' | 'shelf_life_months'
>

/** 判定に使う期限。印字の期限を優先し、なければ製造年月＋年数から計算する */
export function effectiveExpiry(lot: ExpiryFields): EffectiveExpiry | null {
  if (lot.expiry_value && lot.expiry_precision) {
    return { value: lot.expiry_value, precision: lot.expiry_precision, source: 'printed' }
  }
  if (lot.manufactured_value && lot.manufactured_precision && lot.shelf_life_months) {
    return {
      value: addMonthsToValue(lot.manufactured_value, lot.manufactured_precision, lot.shelf_life_months),
      precision: lot.manufactured_precision,
      source: 'computed',
    }
  }
  return null
}

export function expiryInfo(lot: ExpiryFields, today: PlainDate): ExpiryInfo {
  const effective = effectiveExpiry(lot)
  if (!effective) {
    const status: ExpiryStatus =
      lot.expiry_check === 'reported_within_one_year_exact_unknown'
        ? 'within_1_year_date_unknown'
        : lot.expiry_check === 'reported_no_expiry_issue_exact_unknown'
          ? 'reported_ok_date_unknown'
          : 'unknown'
    return { status, effective: null, endDate: null, daysLeft: null }
  }
  const endDate = endOfPeriod(effective.value, effective.precision)
  const daysLeft = daysBetween(today, endDate)
  let status: ExpiryStatus
  if (compareDates(endDate, today) < 0) status = 'expired'
  else if (compareDates(endDate, addMonths(today, 3)) <= 0) status = 'within_3_months'
  else if (compareDates(endDate, addMonths(today, 12)) <= 0) status = 'within_1_year'
  else status = 'ok'
  return { status, effective, endDate, daysLeft }
}

export const EXPIRY_STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: '期限切れ',
  within_3_months: '3か月以内',
  within_1_year: '1年以内',
  ok: '期限内',
  within_1_year_date_unknown: '1年以内・日付未確認',
  reported_ok_date_unknown: '問題なし報告・日付未記録',
  unknown: '期限未確認',
}

/** 並び順（期限が近いものほど前、日付が分からないものは後ろ） */
export const EXPIRY_STATUS_ORDER: ExpiryStatus[] = [
  'expired',
  'within_3_months',
  'within_1_year_date_unknown',
  'within_1_year',
  'ok',
  'reported_ok_date_unknown',
  'unknown',
]

/** 期限の表示。記録どおりに出し、計算した期限には計算元を添える */
export function formatExpiry(lot: ExpiryFields): { text: string; note: string | null } {
  const effective = effectiveExpiry(lot)
  if (!effective) return { text: '未確認', note: null }
  const text = formatDateValue(effective.value, effective.precision)
  if (effective.source === 'printed') return { text, note: null }
  const years = lot.shelf_life_months! % 12 === 0 ? `${lot.shelf_life_months! / 12}年` : `${lot.shelf_life_months}か月`
  return { text, note: `製造${formatDateValue(lot.manufactured_value!, lot.manufactured_precision!)}から${years}で計算` }
}
