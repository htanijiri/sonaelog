// 入力の検証。初期データ（seed）・サーバーのスナップショット・利用者の入力で同じ規則を使う。

import { z } from 'zod'
import { isValidDatePair } from './dates'
import {
  CATEGORIES,
  EXPIRY_CHECKS,
  EXPIRY_KINDS,
  LOCATION_KINDS,
  PRECISIONS,
  SOURCES,
  USE_STATUSES,
} from './types'

const precision = z.enum(PRECISIONS).nullable()
const positiveOrNull = z.number().positive().nullable()

export const componentSchema = z.object({
  name: z.string().min(1),
  quantity_per_box: z.number().positive(),
  unit: z.string().min(1),
})

/** 明細の中身の規則（seed・スナップショット・入力で共通） */
const lotFields = {
  name: z.string().trim().min(1, '品名を入れてください'),
  category: z.enum(CATEGORIES),
  quantity: z.number().min(0, '数量は 0 以上にしてください'),
  unit: z.string().trim().min(1, '単位を入れてください'),
  expiry_check: z.enum(EXPIRY_CHECKS),
  use_status: z.enum(USE_STATUSES),
  source: z.enum(SOURCES),
  needs_review: z.boolean(),
  notes: z.string(),
  liters_per_unit: positiveOrNull,
  kcal_per_unit: positiveOrNull,
  components: z.array(componentSchema).nullable(),
}

type DateRuleTarget = {
  expiry_value: string | null
  expiry_precision: string | null
  expiry_check: string
  manufactured_value?: string | null
  manufactured_precision?: string | null
}

/** 期限・製造年月の組み合わせの規則。DB の CHECK 制約と同じ内容 */
function checkDateRules(v: DateRuleTarget, ctx: z.RefinementCtx) {
  if (!isValidDatePair(v.expiry_value, v.expiry_precision as never)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiry_value'],
      message: `期限の形式が正しくありません（${v.expiry_value ?? 'なし'} / ${v.expiry_precision ?? 'なし'}）`,
    })
  }
  if ((v.expiry_value !== null) !== (v.expiry_check === 'exact_or_month_known')) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiry_check'],
      message: '期限の日付があるときだけ「記録済み（exact_or_month_known）」にしてください',
    })
  }
  if (!isValidDatePair(v.manufactured_value ?? null, (v.manufactured_precision ?? null) as never)) {
    ctx.addIssue({
      code: 'custom',
      path: ['manufactured_value'],
      message: `製造年月の形式が正しくありません（${v.manufactured_value ?? 'なし'}）`,
    })
  }
}

// ---- 初期データ（data/initial-data.json） ----

export const seedLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(LOCATION_KINDS),
  parent: z.string().nullable(),
  physical_note: z.string().nullable().optional(),
})

export const seedLotSchema = z
  .object({
    id: z.string().min(1),
    location_id: z.string().min(1),
    ...lotFields,
    expiry: z.string().nullable(),
    expiry_precision: precision,
    expiry_kind: z.enum(EXPIRY_KINDS).nullable().optional(),
    manufactured_value: z.string().nullable().optional(),
    manufactured_precision: precision.optional(),
    shelf_life_months: z.number().int().positive().nullable().optional(),
    uses_per_unit: positiveOrNull.optional(),
  })
  .superRefine((v, ctx) => checkDateRules({ ...v, expiry_value: v.expiry }, ctx))

export const seedFileSchema = z.object({
  metadata: z.object({
    schema_version: z.literal(1, { error: 'schema_version は 1 だけに対応しています' }),
    snapshot_date: z.string(),
  }),
  locations: z.array(seedLocationSchema).min(1),
  stock_lots: z.array(seedLotSchema),
})

export type SeedFile = z.infer<typeof seedFileSchema>

// ---- サーバーのスナップショット ----

export const locationSchema = z.object({
  id: z.string().min(1),
  seed_code: z.string().nullable(),
  display_name: z.string().min(1),
  kind: z.enum(LOCATION_KINDS),
  physical_note: z.string().nullable(),
  parent_id: z.string().nullable(),
  sort_order: z.number(),
  updated_at: z.string(),
})

const lotInputObject = z.object({
  location_id: z.string().min(1, '保管場所を選んでください'),
  ...lotFields,
  expiry_value: z.string().nullable(),
  expiry_precision: precision,
  expiry_kind: z.enum(EXPIRY_KINDS).nullable(),
  manufactured_value: z.string().nullable(),
  manufactured_precision: precision,
  shelf_life_months: z.number().int().positive('年数は 1 以上にしてください').nullable(),
  uses_per_unit: positiveOrNull,
})

export const lotInputSchema = lotInputObject.superRefine(checkDateRules)

export const lotSchema = lotInputObject
  .extend({
    id: z.string().min(1),
    seed_code: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .superRefine(checkDateRules)

export const snapshotSchema = z
  .object({
    format: z.literal('sonaelog-snapshot'),
    version: z.literal(1),
    household_id: z.string().min(1),
    household_name: z.string(),
    revision: z.number(),
    captured_at: z.string(),
    locations: z.array(locationSchema),
    lots: z.array(lotSchema),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.locations.map((l) => l.id))
    s.lots.forEach((lot, i) => {
      if (!ids.has(lot.location_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lots', i, 'location_id'],
          message: `明細「${lot.name}」の保管場所が見つかりません`,
        })
      }
    })
  })

/** zod のエラーを「どこが・なぜ」の行に整形する */
export function formatIssues(error: z.ZodError, describe?: (path: PropertyKey[]) => string): string[] {
  return error.issues.map((issue) => {
    const where = describe ? describe(issue.path) : issue.path.join('.')
    return `${where}: ${issue.message}`
  })
}
