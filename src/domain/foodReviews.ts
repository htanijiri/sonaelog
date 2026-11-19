// 食料品の味の感想（spec 010）。感想は明細ではなく品名ごとに1つで、家庭で共有する。
// 品名の照合は正規化キーで行う。SQL の private.food_name_key と同じ規則にすること（tests/db/foodReviews.test.ts で一致を確認）。

import type { FoodRating, FoodReview, InventoryLot, Snapshot } from './types'

/** 品名の正規化キー：NFKC（全角英数・全角空白・半角カナを揃える）、前後の空白を除き、連続する空白を半角1つにする */
export function foodNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export const FOOD_RATING_LABEL: Record<FoodRating, string> = {
  again: 'また買う',
  ok: 'ふつう',
  never: 'もう買わない',
}

/** 一覧で並べる順（評価なしは最後） */
export const FOOD_RATING_ORDER: (FoodRating | null)[] = ['again', 'ok', 'never', null]

export const isFood = (lot: Pick<InventoryLot, 'category'>) => lot.category === 'food'

/** 品名からキーで引ける表を作る */
export function reviewIndex(reviews: readonly FoodReview[]): Map<string, FoodReview> {
  return new Map(reviews.map((r) => [r.name_key, r]))
}

/** 明細（食料品のみ）に対応する感想。食料品以外は常に undefined */
export function reviewForLot(index: Map<string, FoodReview>, lot: Pick<InventoryLot, 'name' | 'category'>): FoodReview | undefined {
  return isFood(lot) ? index.get(foodNameKey(lot.name)) : undefined
}

/** 検索の対象にする文字列（評価の表示名とコメント） */
export function reviewSearchText(review: FoodReview | undefined): string {
  if (!review) return ''
  return [review.rating ? FOOD_RATING_LABEL[review.rating] : '', review.comment].filter(Boolean).join(' ')
}

export interface ReviewRow {
  review: FoodReview
  /** 同じ品名の、今ある食料品の明細 */
  lots: InventoryLot[]
  /** 単位ごとの合計（単位の違う数は足さない） */
  stock: { unit: string; quantity: number }[]
}

/** 「味の感想」の画面の行：評価の順 → 品名の順。今の在庫数を単位ごとに添える */
export function reviewRows(snapshot: Pick<Snapshot, 'lots' | 'food_reviews'>): ReviewRow[] {
  const byKey = new Map<string, InventoryLot[]>()
  for (const lot of snapshot.lots) {
    if (!isFood(lot)) continue
    const key = foodNameKey(lot.name)
    byKey.set(key, [...(byKey.get(key) ?? []), lot])
  }
  return snapshot.food_reviews
    .map((review) => {
      const lots = byKey.get(review.name_key) ?? []
      const totals = new Map<string, number>()
      for (const l of lots) totals.set(l.unit, (totals.get(l.unit) ?? 0) + l.quantity)
      return { review, lots, stock: [...totals].map(([unit, quantity]) => ({ unit, quantity })) }
    })
    .sort(
      (a, b) =>
        FOOD_RATING_ORDER.indexOf(a.review.rating) - FOOD_RATING_ORDER.indexOf(b.review.rating) ||
        a.review.display_name.localeCompare(b.review.display_name, 'ja'),
    )
}
