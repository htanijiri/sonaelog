// ダッシュボードの集計。確実に分かる分だけを数え、単位の違う数量や推測の値は足さない。

import type { PlainDate } from './dates'
import { expiryInfo, type ExpiryStatus } from './expiry'
import type { InventoryLot, LocationKind, Snapshot } from './types'

export interface Summary {
  lotCount: number
  /** 単位ごとの数量合計（単位の違うものは足さない） */
  quantityByUnit: Record<string, number>
  byExpiry: Record<ExpiryStatus, number>
  needsReview: number
  byKind: Record<LocationKind, number>
  water: {
    totalLiters: number
    drinkingLiters: number
    /** 飲み水として数えた分のうち、期限が記録されていない分 */
    drinkingUndatedLiters: number
    nonDrinkingLiters: number
    /** 容量（1本あたりのリットル）が分からない水の明細数 */
    unknownVolumeLots: number
  }
  meals: {
    /** 単位が「食」の明細の合計（期限切れでないもの） */
    count: number
    expiredCount: number
    /** 食数に換算していない食品の明細数 */
    notConvertedLots: number
  }
  toilet: {
    /** 公称の使用回数が入力された明細の合計回数 */
    uses: number
    /** トイレ用品で回数が未入力の明細数 */
    missingLots: number
  }
}

const TOILET_NAME = /トイレ|便袋|排泄/

export function isToiletLot(lot: InventoryLot): boolean {
  return lot.category === 'sanitation' && (lot.uses_per_unit !== null || TOILET_NAME.test(lot.name))
}

export function summarize(snapshot: Snapshot, today: PlainDate): Summary {
  const kindByLocation = new Map(snapshot.locations.map((l) => [l.id, l.kind]))
  const s: Summary = {
    lotCount: snapshot.lots.length,
    quantityByUnit: {},
    byExpiry: {
      expired: 0,
      within_3_months: 0,
      within_1_year: 0,
      ok: 0,
      within_1_year_date_unknown: 0,
      reported_ok_date_unknown: 0,
      unknown: 0,
    },
    needsReview: 0,
    byKind: { long_term: 0, go_bag: 0, rolling: 0, pending_consumption: 0, other: 0 },
    water: { totalLiters: 0, drinkingLiters: 0, drinkingUndatedLiters: 0, nonDrinkingLiters: 0, unknownVolumeLots: 0 },
    meals: { count: 0, expiredCount: 0, notConvertedLots: 0 },
    toilet: { uses: 0, missingLots: 0 },
  }
  for (const lot of snapshot.lots) {
    const info = expiryInfo(lot, today)
    s.quantityByUnit[lot.unit] = (s.quantityByUnit[lot.unit] ?? 0) + lot.quantity
    s.byExpiry[info.status] += 1
    if (lot.needs_review) s.needsReview += 1
    const kind = kindByLocation.get(lot.location_id) ?? 'other'
    s.byKind[kind] += 1

    if (lot.category === 'water') {
      if (lot.liters_per_unit === null) {
        s.water.unknownVolumeLots += 1
      } else {
        const liters = lot.quantity * lot.liters_per_unit
        s.water.totalLiters += liters
        if (lot.use_status === 'non_drinking_candidate' || info.status === 'expired') {
          s.water.nonDrinkingLiters += liters
        } else {
          s.water.drinkingLiters += liters
          if (info.effective === null) s.water.drinkingUndatedLiters += liters
        }
      }
    }
    if (lot.category === 'food') {
      if (lot.unit === '食') {
        if (info.status === 'expired') s.meals.expiredCount += lot.quantity
        else s.meals.count += lot.quantity
      } else {
        s.meals.notConvertedLots += 1
      }
    }
    if (isToiletLot(lot)) {
      if (lot.uses_per_unit === null) s.toilet.missingLots += 1
      else s.toilet.uses += lot.quantity * lot.uses_per_unit
    }
  }
  // 小数の誤差を丸める（0.5L × 3 など）
  for (const k of ['totalLiters', 'drinkingLiters', 'drinkingUndatedLiters', 'nonDrinkingLiters'] as const) {
    s.water[k] = Math.round(s.water[k] * 1000) / 1000
  }
  return s
}
