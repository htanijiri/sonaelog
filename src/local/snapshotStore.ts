// 端末内（IndexedDB）の在庫スナップショット。
// 家庭1つ分を「1レコード」として丸ごと置き換えるので、書き込みは常に全部成功か全部失敗のどちらか。

import Dexie, { type Table } from 'dexie'
import { snapshotSchema } from '../domain/schemas'
import type { Snapshot } from '../domain/types'

/** 端末内の保存形式の版。形式を変えたら上げて migrateStored() に移行を書く */
export const LOCAL_FORMAT = 2

export interface StoredSnapshot {
  key: string
  localFormat: number
  userId: string
  householdId: string
  syncedAt: string
  snapshot: Snapshot
}

export interface LastUser {
  key: 'lastUser'
  userId: string
  householdId: string
  email: string
}

export interface PersistInfo {
  key: 'persist'
  supported: boolean
  granted: boolean
  at: string
}

type MetaRow = LastUser | PersistInfo

class LocalDb extends Dexie {
  snapshots!: Table<StoredSnapshot, string>
  meta!: Table<MetaRow, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({ snapshots: 'key', meta: 'key' })
  }
}

export const snapshotKey = (userId: string, householdId: string) => `${userId}:${householdId}`

export type LoadResult =
  | { status: 'none' }
  | { status: 'ok'; stored: StoredSnapshot; lastUser: LastUser }
  | { status: 'incompatible'; lastUser: LastUser }

/**
 * 古い版の保存形式を今の形式に直す。未知の新しい版（アプリが古い）は null を返し、使わない。
 * v1 → v2：製造年月・期限の種類・トイレの回数の列を追加（無ければ null）。
 */
export function migrateStored(row: Record<string, unknown>): StoredSnapshot | null {
  const format = Number(row.localFormat)
  if (!Number.isInteger(format) || format > LOCAL_FORMAT || format < 1) return null
  let current = row as unknown as StoredSnapshot
  if (format === 1) {
    current = {
      ...current,
      localFormat: 2,
      snapshot: {
        ...current.snapshot,
        // v1 には無い列なので、無ければ null を入れる
        lots: current.snapshot.lots.map((l) => {
          const old = l as Partial<typeof l>
          return {
            ...l,
            expiry_kind: old.expiry_kind ?? null,
            manufactured_value: old.manufactured_value ?? null,
            manufactured_precision: old.manufactured_precision ?? null,
            shelf_life_months: old.shelf_life_months ?? null,
            uses_per_unit: old.uses_per_unit ?? null,
          }
        }),
      },
    }
  }
  const parsed = snapshotSchema.safeParse(current.snapshot)
  return parsed.success ? current : null
}

export class SnapshotStore {
  private db: LocalDb
  constructor(name = 'sonaelog') {
    this.db = new LocalDb(name)
  }

  /** 最後にログインしたユーザーのスナップショットを読む */
  async load(): Promise<LoadResult> {
    const lastUser = (await this.db.meta.get('lastUser')) as LastUser | undefined
    if (!lastUser) return { status: 'none' }
    const row = await this.db.snapshots.get(snapshotKey(lastUser.userId, lastUser.householdId))
    if (!row) return { status: 'none' }
    const stored = migrateStored(row as unknown as Record<string, unknown>)
    if (!stored) return { status: 'incompatible', lastUser }
    return { status: 'ok', stored, lastUser }
  }

  /** スナップショットと「最後のユーザー」を1トランザクションで保存する */
  async save(user: { id: string; email: string }, snapshot: Snapshot, syncedAt: string): Promise<StoredSnapshot> {
    const stored: StoredSnapshot = {
      key: snapshotKey(user.id, snapshot.household_id),
      localFormat: LOCAL_FORMAT,
      userId: user.id,
      householdId: snapshot.household_id,
      syncedAt,
      snapshot,
    }
    await this.db.transaction('rw', this.db.snapshots, this.db.meta, async () => {
      await this.db.snapshots.put(stored)
      await this.db.meta.put({ key: 'lastUser', userId: user.id, householdId: snapshot.household_id, email: user.email })
    })
    return stored
  }

  /** この端末の在庫データ（全家庭分）と「最後のユーザー」を消す */
  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.snapshots, this.db.meta, async () => {
      await this.db.snapshots.clear()
      await this.db.meta.delete('lastUser')
    })
  }

  async getPersistInfo(): Promise<PersistInfo | undefined> {
    return (await this.db.meta.get('persist')) as PersistInfo | undefined
  }

  async setPersistInfo(info: Omit<PersistInfo, 'key'>): Promise<void> {
    await this.db.meta.put({ key: 'persist', ...info })
  }

  /** テスト用：内部の Dexie を返す */
  get raw(): LocalDb {
    return this.db
  }
}

/** 永続保存（ブラウザに自動削除しないよう頼む）を申請し、結果を返す */
export async function requestPersistentStorage(): Promise<Omit<PersistInfo, 'key'>> {
  const at = new Date().toISOString()
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return { supported: false, granted: false, at }
  try {
    const already = await navigator.storage.persisted()
    const granted = already || (await navigator.storage.persist())
    return { supported: true, granted, at }
  } catch {
    return { supported: true, granted: false, at }
  }
}
