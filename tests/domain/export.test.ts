import { describe, expect, it } from 'vitest'
import { exportCsv, exportJson, fileStamp } from '../../src/domain/exportData'
import { sampleSnapshot, TODAY } from './helpers'

describe('008 書き出し', () => {
  const snap = sampleSnapshot()
  it('AC1：JSON は決まった形で、明細数がスナップショットと一致する', () => {
    const j = JSON.parse(exportJson(snap, '2026-11-03T10:00:00.000Z'))
    expect(j).toMatchObject({ format: 'sonaelog-export', version: 1, exported_at: '2026-11-03T10:00:00.000Z', snapshot_captured_at: snap.captured_at, household_id: 'h' })
    expect(j.lots).toHaveLength(snap.lots.length)
    expect(j.locations).toHaveLength(snap.locations.length)
  })
  it('AC2：CSV は BOM 付き・CRLF、期限は記録どおり、特殊文字はエスケープ', () => {
    const copy = structuredClone(snap)
    copy.lots[0]!.notes = 'カンマ,と"引用符"と\n改行'
    const csv = exportCsv(copy, TODAY)
    expect(csv.startsWith('﻿保管場所,')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('"カンマ,と""引用符""と\n改行"')
    expect(csv).toContain(',2027-08,month,')
    const lines = csv.split('\r\n').filter(Boolean)
    // ヘッダ＋明細。値の中の改行（\n）は行区切り（\r\n）と区別される
    expect(lines).toHaveLength(snap.lots.length + 1)
  })
  it('CSV に製造年月・計算した期限の列がある', () => {
    const csv = exportCsv(snap, TODAY)
    const gas = csv.split('\r\n').find((l) => l.includes('見本のカセットガス'))!
    expect(gas).toContain('2024-05,7,2031-05')
  })
  it('AC6：認証トークンやキーを含まない', () => {
    const all = exportJson(snap, 'x') + exportCsv(snap, TODAY)
    expect(all).not.toMatch(/access_token|refresh_token|sb_secret|sb_publishable|eyJhbGci/)
  })
  it('ファイル名の日時は日本時間', () => {
    expect(fileStamp('2026-11-03T16:05:00Z')).toBe('20261104-0105')
  })
})
