// バックアップの書き出し（JSON / CSV）。端末に保存済みのスナップショットから作るので、オフラインでも使える。

import type { PlainDate } from './dates'
import { effectiveExpiry, EXPIRY_STATUS_LABEL, expiryInfo } from './expiry'
import {
  CATEGORY_LABEL,
  EXPIRY_CHECK_LABEL,
  EXPIRY_KIND_LABEL,
  label,
  LOCATION_KIND_LABEL,
  SOURCE_LABEL,
  USE_STATUS_LABEL,
} from './labels'
import type { Snapshot } from './types'

export function exportJson(snapshot: Snapshot, exportedAt: string): string {
  return JSON.stringify(
    {
      format: 'sonaelog-export',
      version: 1,
      exported_at: exportedAt,
      snapshot_captured_at: snapshot.captured_at,
      household_id: snapshot.household_id,
      household_name: snapshot.household_name,
      locations: snapshot.locations,
      lots: snapshot.lots,
    },
    null,
    2,
  )
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADER = [
  '保管場所',
  '区分',
  'カテゴリ',
  '品名',
  '数量',
  '単位',
  '期限',
  '期限の精度',
  '期限の種類',
  '製造年月',
  '製造から年数',
  '計算した期限',
  '期限の確認状況',
  '期限の状態',
  '管理の状態',
  '出どころ',
  '要確認',
  '1本あたりL',
  '公称使用回数',
  'メモ',
  'セット内訳',
  '最終更新',
]

/** Excel で文字化けしないよう UTF-8 BOM 付き・CRLF で返す */
export function exportCsv(snapshot: Snapshot, today: PlainDate): string {
  const locations = new Map(snapshot.locations.map((l) => [l.id, l]))
  const rows = snapshot.lots.map((lot) => {
    const loc = locations.get(lot.location_id)
    const eff = effectiveExpiry(lot)
    return [
      loc?.display_name ?? '',
      loc ? label(LOCATION_KIND_LABEL, loc.kind) : '',
      label(CATEGORY_LABEL, lot.category),
      lot.name,
      lot.quantity,
      lot.unit,
      lot.expiry_value ?? '',
      lot.expiry_precision ?? '',
      EXPIRY_KIND_LABEL[lot.expiry_kind ?? 'none'],
      lot.manufactured_value ?? '',
      lot.shelf_life_months === null ? '' : lot.shelf_life_months / 12,
      eff?.source === 'computed' ? eff.value : '',
      label(EXPIRY_CHECK_LABEL, lot.expiry_check),
      EXPIRY_STATUS_LABEL[expiryInfo(lot, today).status],
      label(USE_STATUS_LABEL, lot.use_status),
      label(SOURCE_LABEL, lot.source),
      lot.needs_review ? '要確認' : '',
      lot.liters_per_unit ?? '',
      lot.uses_per_unit ?? '',
      lot.notes,
      (lot.components ?? []).map((c) => `${c.name}×${c.quantity_per_box}/${c.unit}`).join(';'),
      lot.updated_at,
    ]
  })
  return '﻿' + [HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** ファイル名用の日時（日本時間、YYYYMMDD-HHmm） */
export function fileStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`
}
