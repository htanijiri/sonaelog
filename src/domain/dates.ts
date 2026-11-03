// 日付を「年・月・日の整数」で扱う。Date のタイムゾーンずれを避けるため、比較・加算はここだけで行う。

import type { Precision } from './types'

export interface PlainDate {
  y: number
  m: number // 1-12
  d: number // 1-31
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 期限・製造年月の文字列が precision と合っていて、実在する日付か */
export function isValidDateValue(value: string, precision: Precision): boolean {
  if (precision === 'day') {
    const r = DAY_RE.exec(value)
    if (!r) return false
    const [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
  }
  const r = MONTH_RE.exec(value)
  if (!r) return false
  const m = Number(r[2])
  return m >= 1 && m <= 12
}

/** 値と精度の組み合わせが妥当か（両方 null も可） */
export function isValidDatePair(value: string | null, precision: Precision | null): boolean {
  if (value === null && precision === null) return true
  if (value === null || precision === null) return false
  return isValidDateValue(value, precision)
}

/** その期限が有効な最後の日。月精度なら月末 */
export function endOfPeriod(value: string, precision: Precision): PlainDate {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number?]
  if (precision === 'day') return { y, m, d: d ?? 1 }
  return { y, m, d: daysInMonth(y, m) }
}

/** 月数を足す。日精度で存在しない日（2/29 → 平年など）は月末に丸める */
export function addMonthsToValue(value: string, precision: Precision, months: number): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number?]
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const mm = String(nm).padStart(2, '0')
  if (precision === 'month') return `${ny}-${mm}`
  const nd = Math.min(d ?? 1, daysInMonth(ny, nm))
  return `${ny}-${mm}-${String(nd).padStart(2, '0')}`
}

export function addMonths(date: PlainDate, months: number): PlainDate {
  const total = date.y * 12 + (date.m - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) }
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d
}

export function toEpochDay(date: PlainDate): number {
  return Math.floor(Date.UTC(date.y, date.m - 1, date.d) / 86_400_000)
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

const tokyoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 日本時間（Asia/Tokyo）での「今日」。端末のタイムゾーン設定に左右されない */
export function todayInTokyo(now: Date = new Date()): PlainDate {
  const [y, m, d] = tokyoDateFormat.format(now).split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

/** 記録どおりの表示。「2027年8月」「2030年11月8日」。日にちを補わない */
export function formatDateValue(value: string, precision: Precision): string {
  const [y, m, d] = value.split('-').map(Number)
  return precision === 'month' ? `${y}年${m}月` : `${y}年${m}月${d}日`
}

const tokyoDateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** ISO 日時を日本時間の「YYYY/MM/DD HH:mm」で表示 */
export function formatDateTime(iso: string): string {
  return tokyoDateTimeFormat.format(new Date(iso))
}
