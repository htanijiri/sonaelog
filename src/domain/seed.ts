// 初期データ（seed ファイル）の検証と、DB／疑似クラウドに入れる形への変換。

import { formatIssues, seedFileSchema, type SeedFile } from './schemas'
import type { InventoryLot, StorageLocation } from './types'

export interface SeedValidationResult {
  ok: boolean
  errors: string[]
  data?: SeedFile
}

/** 形式の検証に加えて、ID の重複と保管場所の参照を確かめる */
export function validateSeed(raw: unknown): SeedValidationResult {
  const parsed = seedFileSchema.safeParse(raw)
  const rawLots = (raw as { stock_lots?: { id?: string }[] })?.stock_lots ?? []
  const rawLocations = (raw as { locations?: { id?: string }[] })?.locations ?? []
  const describe = (path: PropertyKey[]) => {
    const [top, index, ...rest] = path
    if (top === 'stock_lots' && typeof index === 'number') {
      return `明細 ${rawLots[index]?.id ?? `#${index}`} の ${rest.join('.') || '全体'}`
    }
    if (top === 'locations' && typeof index === 'number') {
      return `保管場所 ${rawLocations[index]?.id ?? `#${index}`} の ${rest.join('.') || '全体'}`
    }
    return path.join('.') || '全体'
  }
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error, describe) }

  const data = parsed.data
  const errors: string[] = []
  const locationIds = new Set<string>()
  for (const loc of data.locations) {
    if (locationIds.has(loc.id)) errors.push(`保管場所 ${loc.id}: ID が重複しています`)
    locationIds.add(loc.id)
  }
  for (const loc of data.locations) {
    if (loc.parent !== null && !locationIds.has(loc.parent)) {
      errors.push(`保管場所 ${loc.id}: 親の保管場所 ${loc.parent} が存在しません`)
    }
  }
  const lotIds = new Set<string>()
  for (const lot of data.stock_lots) {
    if (lotIds.has(lot.id)) errors.push(`明細 ${lot.id}: ID が重複しています`)
    lotIds.add(lot.id)
    if (!locationIds.has(lot.location_id)) {
      errors.push(`明細 ${lot.id}: 保管場所 ${lot.location_id} が存在しません`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], data }
}

/** seed の保管場所1件を DB の形にする（id は呼び出し側で決める） */
export function seedLocationRow(loc: SeedFile['locations'][number], index: number) {
  return {
    seed_code: loc.id,
    display_name: loc.name,
    kind: loc.type,
    physical_note: loc.physical_note ?? null,
    parent_seed_code: loc.parent,
    sort_order: index,
  }
}

/** seed の明細1件を DB の形にする。初期データにない列は null */
export function seedLotRow(lot: SeedFile['stock_lots'][number]) {
  return {
    seed_code: lot.id,
    location_seed_code: lot.location_id,
    name: lot.name,
    category: lot.category,
    quantity: lot.quantity,
    unit: lot.unit,
    expiry_value: lot.expiry,
    expiry_precision: lot.expiry_precision,
    expiry_kind: lot.expiry_kind ?? null,
    manufactured_value: lot.manufactured_value ?? null,
    manufactured_precision: lot.manufactured_precision ?? null,
    shelf_life_months: lot.shelf_life_months ?? null,
    expiry_check: lot.expiry_check,
    use_status: lot.use_status,
    source: lot.source,
    needs_review: lot.needs_review,
    notes: lot.notes,
    liters_per_unit: lot.liters_per_unit,
    kcal_per_unit: lot.kcal_per_unit,
    uses_per_unit: lot.uses_per_unit ?? null,
    components: lot.components,
  }
}

/** seed_household() に渡す形 */
export function seedPayload(data: SeedFile) {
  return {
    locations: data.locations.map(seedLocationRow),
    lots: data.stock_lots.map(seedLotRow),
  }
}

/** 疑似クラウド・テスト用に、seed から保管場所と明細を作る */
export function seedToRows(
  data: SeedFile,
  newId: () => string,
  now: string,
): { locations: StorageLocation[]; lots: InventoryLot[] } {
  const idBySeed = new Map<string, string>()
  for (const loc of data.locations) idBySeed.set(loc.id, newId())
  const locations: StorageLocation[] = data.locations.map((loc, i) => {
    const row = seedLocationRow(loc, i)
    return {
      id: idBySeed.get(loc.id)!,
      seed_code: row.seed_code,
      display_name: row.display_name,
      kind: row.kind,
      physical_note: row.physical_note,
      parent_id: row.parent_seed_code ? (idBySeed.get(row.parent_seed_code) ?? null) : null,
      sort_order: row.sort_order,
      updated_at: now,
    }
  })
  const lots: InventoryLot[] = data.stock_lots.map((lot) => {
    const { location_seed_code, ...row } = seedLotRow(lot)
    return {
      ...row,
      id: newId(),
      location_id: idBySeed.get(location_seed_code)!,
      created_at: now,
      updated_at: now,
    }
  })
  return { locations, lots }
}
