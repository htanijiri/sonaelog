// 在庫データの型。DB（Supabase）の列名と同じ snake_case で持ち、変換の手間と取り違えをなくす。

export const CATEGORIES = [
  'food',
  'water',
  'fuel',
  'power',
  'sanitation',
  'medical',
  'shelter',
  'safety',
  'communication',
  'tools',
  'tableware',
  'children',
  'unknown',
] as const
export type Category = (typeof CATEGORIES)[number]

export const USE_STATUSES = [
  'stored',
  'removed_for_consumption',
  'non_drinking_candidate',
  'replacement_planned',
  'expired_trial',
  'near_expiry_keep_pending',
] as const
export type UseStatus = (typeof USE_STATUSES)[number]

export const EXPIRY_CHECKS = [
  'exact_or_month_known',
  'not_recorded',
  'reported_no_expiry_issue_exact_unknown',
  'reported_within_one_year_exact_unknown',
] as const
export type ExpiryCheck = (typeof EXPIRY_CHECKS)[number]

export const SOURCES = ['user', 'photo_review', 'user_confirmed'] as const
export type Source = (typeof SOURCES)[number]

export const LOCATION_KINDS = ['long_term', 'go_bag', 'rolling', 'pending_consumption', 'other'] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

export const PRECISIONS = ['day', 'month'] as const
export type Precision = (typeof PRECISIONS)[number]

export const EXPIRY_KINDS = ['best_before', 'use_or_inspection'] as const
export type ExpiryKind = (typeof EXPIRY_KINDS)[number]

export interface Component {
  name: string
  quantity_per_box: number
  unit: string
}

export interface StorageLocation {
  id: string
  seed_code: string | null
  display_name: string
  kind: LocationKind
  physical_note: string | null
  parent_id: string | null
  sort_order: number
  updated_at: string
}

export interface InventoryLot {
  id: string
  seed_code: string | null
  location_id: string
  name: string
  category: Category
  quantity: number
  unit: string
  expiry_value: string | null
  expiry_precision: Precision | null
  expiry_kind: ExpiryKind | null
  manufactured_value: string | null
  manufactured_precision: Precision | null
  shelf_life_months: number | null
  expiry_check: ExpiryCheck
  use_status: UseStatus
  source: Source
  needs_review: boolean
  notes: string
  liters_per_unit: number | null
  kcal_per_unit: number | null
  uses_per_unit: number | null
  components: Component[] | null
  created_at: string
  updated_at: string
}

/** サーバーから読み取った、家庭1つ分の完全な在庫スナップショット */
export interface Snapshot {
  format: 'sonaelog-snapshot'
  version: 1
  household_id: string
  household_name: string
  revision: number
  captured_at: string
  locations: StorageLocation[]
  lots: InventoryLot[]
}

/** 追加・更新のときに利用者が入力する項目（id や日時はサーバーが決める） */
export type LotInput = Omit<InventoryLot, 'id' | 'seed_code' | 'created_at' | 'updated_at'>
