// アプリ全体の状態（端末内の在庫・通信・同期・ログイン）と、その操作。
// 閲覧できるかどうかは「端末に保存済みか」だけで決まり、ログイン状態や通信状態には左右されない。

import { BackendError, type AuthUser, type Backend } from '../backend/types'
import type { Change } from '../domain/changes'
import { formatIssues, snapshotSchema } from '../domain/schemas'
import type { Snapshot } from '../domain/types'
import { requestPersistentStorage, type PersistInfo, type SnapshotStore, type StoredSnapshot } from '../local/snapshotStore'

export type LocalState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'incompatible' }
  | { status: 'ok'; stored: StoredSnapshot }

export type SyncState = 'idle' | 'syncing' | 'ok' | 'failed'
export type AuthState = 'unknown' | 'signedIn' | 'needsReauth' | 'signedOut'

export interface AppState {
  local: LocalState
  online: boolean
  sync: SyncState
  syncMessage: string | null
  auth: AuthState
  user: AuthUser | null
  /** 最後にログインした人のメールアドレス（オフラインでも表示できるよう端末に保存） */
  email: string | null
  /** クラウドには保存できたが、端末の保存分を更新できなかった */
  localStale: boolean
  persist: PersistInfo | null
}

export type ChangeResult =
  | { ok: true; localUpdated: boolean }
  | { ok: false; code: BackendError['code']; message: string }

type Listener = () => void

export function canEdit(s: AppState): boolean {
  return s.online && s.auth === 'signedIn' && s.local.status === 'ok' && s.sync !== 'syncing'
}

export function snapshotOf(s: AppState): Snapshot | null {
  return s.local.status === 'ok' ? s.local.stored.snapshot : null
}

export class AppController {
  private state: AppState
  private listeners = new Set<Listener>()
  private syncing: Promise<void> | null = null

  constructor(
    private backend: Backend,
    private store: SnapshotStore,
    online = typeof navigator === 'undefined' ? true : navigator.onLine,
  ) {
    this.state = {
      local: { status: 'loading' },
      online,
      sync: 'idle',
      syncMessage: null,
      auth: 'unknown',
      user: null,
      email: null,
      localStale: false,
      persist: null,
    }
  }

  getState = (): AppState => this.state

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  /** 起動時：まず端末内の在庫を読み、それから（オンラインなら）同期する */
  async init(): Promise<void> {
    try {
      const loaded = await this.store.load()
      if (loaded.status === 'ok') this.set({ local: { status: 'ok', stored: loaded.stored }, email: loaded.lastUser.email })
      else if (loaded.status === 'incompatible') this.set({ local: { status: 'incompatible' }, email: loaded.lastUser.email })
      else this.set({ local: { status: 'none' } })
    } catch {
      this.set({ local: { status: 'none' } })
    }
    this.set({ persist: (await this.store.getPersistInfo().catch(() => undefined)) ?? null })
    await this.syncNow()
  }

  setOnline(online: boolean): void {
    const cameBack = online && !this.state.online
    this.set({ online })
    if (cameBack) void this.syncNow()
  }

  /** クラウドから完全なスナップショットを取り、検証してから端末に保存する。多重に走らせない */
  syncNow(): Promise<void> {
    if (this.syncing) return this.syncing
    this.syncing = this.doSync().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async doSync(): Promise<void> {
    if (!this.state.online) {
      this.set({ sync: 'idle' })
      return
    }
    this.set({ sync: 'syncing', syncMessage: null })
    const auth = await this.backend.checkAuth()
    if (auth.status === 'signedOut') {
      this.set({ auth: 'signedOut', user: null, sync: 'idle' })
      return
    }
    if (auth.status === 'needsReauth') {
      this.set({ auth: 'needsReauth', user: null, sync: 'idle' })
      return
    }
    if (auth.status === 'unreachable') {
      this.set({ sync: 'failed', syncMessage: 'クラウドに接続できませんでした' })
      return
    }
    this.set({ auth: 'signedIn', user: auth.user, email: auth.user.email })
    try {
      await this.fetchAndStore(auth.user)
      this.set({ sync: 'ok', syncMessage: null, localStale: false })
    } catch (e) {
      if (e instanceof BackendError && e.code === 'auth') {
        this.set({ auth: 'needsReauth', user: null, sync: 'idle' })
        return
      }
      this.set({ sync: 'failed', syncMessage: e instanceof Error ? e.message : '同期に失敗しました' })
    }
  }

  private async fetchAndStore(user: AuthUser): Promise<void> {
    const raw = await this.backend.fetchSnapshot()
    const parsed = snapshotSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`クラウドのデータの検査に失敗しました：${formatIssues(parsed.error).slice(0, 3).join(' / ')}`)
    }
    const stored = await this.store.save(user, parsed.data as Snapshot, new Date().toISOString())
    this.set({ local: { status: 'ok', stored } })
    // 初回保存のときに永続保存を申請する（結果は設定画面に出す）
    if (!this.state.persist) {
      const info = await requestPersistentStorage()
      await this.store.setPersistInfo(info).catch(() => undefined)
      this.set({ persist: { key: 'persist', ...info } })
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    const user = await this.backend.signIn(email, password)
    this.set({ auth: 'signedIn', user, email: user.email })
    await this.syncNow()
  }

  /** ログアウト。clearLocal なら端末内の在庫も消す */
  async signOut(clearLocal: boolean): Promise<void> {
    await this.backend.signOut()
    if (clearLocal) {
      await this.store.clear()
      this.set({ local: { status: 'none' }, email: null, localStale: false })
    }
    this.set({ auth: 'signedOut', user: null, sync: 'idle' })
  }

  /** クラウドに変更を保存し、成功したら新しいスナップショットを取り直す */
  async applyChange(change: Change): Promise<ChangeResult> {
    if (!canEdit(this.state)) {
      return { ok: false, code: this.state.online ? 'auth' : 'offline', message: this.state.online ? '編集するには再ログインが必要です' : 'オフラインのため編集できません' }
    }
    try {
      await this.backend.applyChange(change)
    } catch (e) {
      if (e instanceof BackendError) {
        if (e.code === 'auth') this.set({ auth: 'needsReauth', user: null })
        return { ok: false, code: e.code, message: e.message }
      }
      return { ok: false, code: 'unknown', message: e instanceof Error ? e.message : String(e) }
    }
    try {
      await this.fetchAndStore(this.state.user!)
      this.set({ localStale: false, sync: 'ok', syncMessage: null })
      return { ok: true, localUpdated: true }
    } catch {
      this.set({ localStale: true, sync: 'failed', syncMessage: 'クラウドには保存済み・この端末は未更新です' })
      return { ok: true, localUpdated: false }
    }
  }
}
