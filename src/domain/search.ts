// 在庫一覧の検索・絞り込み・並べ替え。オンライン・オフラインで同じ処理を使う。

import { compareDates, type PlainDate } from './dates'
import { EXPIRY_STATUS_ORDER, expiryInfo, type ExpiryInfo, type ExpiryStatus } from './expiry'
import type { Category, InventoryLot, Snapshot, StorageLocation, UseStatus } from './types'

/** 全角・半角、カタカナ・ひらがな、大文字・小文字の違いをなくす */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}

export type SortKey = 'expiry' | 'name' | 'location' | 'updated'

export interface ItemFilter {
  q?: string
  category?: Category
  location?: string
  useStatus?: UseStatus
  expiry?: ExpiryStatus
  review?: boolean
  sort?: SortKey
}

export interface ItemRow {
  lot: InventoryLot
  location: StorageLocation | undefined
  expiry: ExpiryInfo
}

export function filterItems(snapshot: Snapshot, filter: ItemFilter, today: PlainDate): ItemRow[] {
  const locations = new Map(snapshot.locations.map((l) => [l.id, l]))
  const terms = normalizeText(filter.q ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const rows: ItemRow[] = []
  for (const lot of snapshot.lots) {
    if (filter.category && lot.category !== filter.category) continue
    if (filter.location && lot.location_id !== filter.location) continue
    if (filter.useStatus && lot.use_status !== filter.useStatus) continue
    if (filter.review && !lot.needs_review) continue
    if (terms.length) {
      const hay = normalizeText(`${lot.name} ${lot.notes}`)
      if (!terms.every((t) => hay.includes(t))) continue
    }
    const expiry = expiryInfo(lot, today)
    if (filter.expiry && expiry.status !== filter.expiry) continue
    rows.push({ lot, location: locations.get(lot.location_id), expiry })
  }
  return sortItems(rows, filter.sort ?? 'expiry')
}

const byName = (a: ItemRow, b: ItemRow) => a.lot.name.localeCompare(b.lot.name, 'ja')
const byLocation = (a: ItemRow, b: ItemRow) =>
  (a.location?.sort_order ?? 1e9) - (b.location?.sort_order ?? 1e9)

/** 期限が近い順。日付が分かるものを先に、分からないものは状態の順で後ろに */
const byExpiry = (a: ItemRow, b: ItemRow) => {
  if (a.expiry.endDate && b.expiry.endDate) return compareDates(a.expiry.endDate, b.expiry.endDate)
  if (a.expiry.endDate) return -1
  if (b.expiry.endDate) return 1
  return EXPIRY_STATUS_ORDER.indexOf(a.expiry.status) - EXPIRY_STATUS_ORDER.indexOf(b.expiry.status)
}

export function sortItems(rows: ItemRow[], key: SortKey): ItemRow[] {
  const cmp: Record<SortKey, (a: ItemRow, b: ItemRow) => number> = {
    // 同じ品名が隣り合うよう、品名を第2キーにする
    expiry: (a, b) => byExpiry(a, b) || byName(a, b) || byLocation(a, b),
    name: (a, b) => byName(a, b) || byLocation(a, b) || byExpiry(a, b),
    location: (a, b) => byLocation(a, b) || byName(a, b) || byExpiry(a, b),
    updated: (a, b) => b.lot.updated_at.localeCompare(a.lot.updated_at) || byName(a, b),
  }
  return [...rows].sort(cmp[key])
}

/** URL のクエリ文字列 ⇔ 絞り込み条件 */
export function filterFromParams(p: URLSearchParams): ItemFilter {
  return {
    q: p.get('q') ?? undefined,
    category: (p.get('category') as Category) ?? undefined,
    location: p.get('location') ?? undefined,
    useStatus: (p.get('status') as UseStatus) ?? undefined,
    expiry: (p.get('expiry') as ExpiryStatus) ?? undefined,
    review: p.get('review') === '1' || undefined,
    sort: (p.get('sort') as SortKey) ?? undefined,
  }
}

export function paramsFromFilter(f: ItemFilter): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.category) p.set('category', f.category)
  if (f.location) p.set('location', f.location)
  if (f.useStatus) p.set('status', f.useStatus)
  if (f.expiry) p.set('expiry', f.expiry)
  if (f.review) p.set('review', '1')
  if (f.sort && f.sort !== 'expiry') p.set('sort', f.sort)
  return p
}
