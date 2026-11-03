// 「製造から○年」の候補。目安なので、品のラベルや説明書と違うときは利用者が数字を直接入れる。

import { normalizeText } from './search'
import type { InventoryLot } from './types'

export interface ShelfLifePreset {
  label: string
  months: number
}

export const SHELF_LIFE_PRESETS: ShelfLifePreset[] = [{ label: 'カセットガス', months: 84 }]

/** 固定の候補に、同じ品名の明細で使った年数を加える（重複は除く） */
export function shelfLifeSuggestions(name: string, lots: InventoryLot[], excludeId?: string): ShelfLifePreset[] {
  const key = normalizeText(name.trim())
  const used = new Set<number>()
  const fromLots: ShelfLifePreset[] = []
  if (key) {
    for (const lot of lots) {
      if (lot.id === excludeId || lot.shelf_life_months === null) continue
      if (normalizeText(lot.name) !== key || used.has(lot.shelf_life_months)) continue
      used.add(lot.shelf_life_months)
      fromLots.push({ label: `前回の「${lot.name}」`, months: lot.shelf_life_months })
    }
  }
  return [...SHELF_LIFE_PRESETS, ...fromLots]
}

export function monthsLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12}年` : `${months}か月`
}
