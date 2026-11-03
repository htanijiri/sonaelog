import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BackendError, type AuthCheck, type Backend } from '../../src/backend/types'
import { LOCAL_FORMAT, migrateStored, SnapshotStore } from '../../src/local/snapshotStore'
import { AppController, canEdit } from '../../src/state/controller'
import { sampleSnapshot } from '../domain/helpers'

const USER = { id: 'u1', email: 'a@example.test' }

interface FakeBackend extends Backend {
  snapshot: ReturnType<typeof sampleSnapshot>
  auth: AuthCheck
  checkAuth: Mock<() => Promise<AuthCheck>>
  fetchSnapshot: Mock<() => Promise<unknown>>
  applyChange: Mock<Backend['applyChange']>
}

function fakeBackend(overrides: Partial<Backend> = {}): FakeBackend {
  const b: FakeBackend = {
    kind: 'demo',
    snapshot: sampleSnapshot(),
    auth: { status: 'signedIn', user: USER },
    checkAuth: vi.fn(async (): Promise<AuthCheck> => b.auth),
    signIn: vi.fn(async () => USER),
    signOut: vi.fn(async () => undefined),
    fetchSnapshot: vi.fn(async (): Promise<unknown> => structuredClone(b.snapshot)),
    applyChange: vi.fn(async () => undefined),
  }
  return Object.assign(b, overrides)
}

let dbName = 0
const newStore = () => new SnapshotStore(`test-${++dbName}`)

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true, storage: { persist: async () => true, persisted: async () => false } })
})

describe('005 端末内保存と同期', () => {
  it('起動するとクラウドから取得して端末に保存し、保存済みになる', async () => {
    const store = newStore()
    const ctl = new AppController(fakeBackend(), store)
    await ctl.init()
    const s = ctl.getState()
    expect(s.local.status).toBe('ok')
    expect(s.sync).toBe('ok')
    expect(canEdit(s)).toBe(true)
    const loaded = await store.load()
    expect(loaded.status).toBe('ok')
  })

  it('AC10：初回保存で永続保存を申請し、結果を保存する', async () => {
    const store = newStore()
    const ctl = new AppController(fakeBackend(), store)
    await ctl.init()
    expect(ctl.getState().persist).toMatchObject({ supported: true, granted: true })
    expect(await store.getPersistInfo()).toMatchObject({ supported: true, granted: true })
  })

  it('AC3：検証に失敗した取得結果は保存せず、前回のスナップショットと同期日時が残る', async () => {
    const store = newStore()
    const backend = fakeBackend()
    const ctl = new AppController(backend, store)
    await ctl.init()
    const before = ctl.getState().local
    backend.fetchSnapshot.mockResolvedValueOnce({ ...backend.snapshot, lots: backend.snapshot.lots.map((l) => ({ ...l, location_id: 'missing' })) })
    await ctl.syncNow()
    const s = ctl.getState()
    expect(s.sync).toBe('failed')
    expect(s.syncMessage).toMatch(/検査に失敗/)
    expect(s.local).toEqual(before)
    const loaded = await store.load()
    expect(loaded.status === 'ok' && loaded.stored.snapshot.lots[0]!.location_id).not.toBe('missing')
  })

  it('AC4：IndexedDB の書き込みが途中で失敗しても、前回のスナップショットで閲覧できる', async () => {
    const store = newStore()
    const backend = fakeBackend()
    const ctl = new AppController(backend, store)
    await ctl.init()
    const before = (await store.load()) as { stored: { syncedAt: string; snapshot: { lots: unknown[] } } }
    // トランザクションの途中（スナップショットを書いたあと）で例外を起こす
    const meta = store.raw.meta
    const orig = meta.put.bind(meta)
    meta.put = (() => {
      throw new Error('書き込み失敗（テスト）')
    }) as typeof meta.put
    backend.snapshot = { ...backend.snapshot, lots: backend.snapshot.lots.slice(0, 5), revision: 99 }
    await ctl.syncNow()
    meta.put = orig
    expect(ctl.getState().sync).toBe('failed')
    const after = (await store.load()) as typeof before
    expect(after.stored.snapshot.lots).toHaveLength(before.stored.snapshot.lots.length)
    expect(after.stored.syncedAt).toBe(before.stored.syncedAt)
    // 再起動しても前回分で閲覧できる
    const ctl2 = new AppController(fakeBackend({ checkAuth: async () => ({ status: 'unreachable' }) }), store, false)
    await ctl2.init()
    expect(ctl2.getState().local.status).toBe('ok')
  })

  it('AC6：クラウド保存は成功・再取得に失敗したら「端末は未更新」の警告', async () => {
    const backend = fakeBackend()
    const ctl = new AppController(backend, newStore())
    await ctl.init()
    backend.fetchSnapshot.mockRejectedValueOnce(new BackendError('offline', '通信できませんでした'))
    const lot = backend.snapshot.lots[0]!
    const r = await ctl.applyChange({ type: 'set_quantity', lot_id: lot.id, expected_updated_at: lot.updated_at, quantity: 1 })
    expect(r).toEqual({ ok: true, localUpdated: false })
    expect(ctl.getState().localStale).toBe(true)
    await ctl.syncNow()
    expect(ctl.getState().localStale).toBe(false)
  })

  it('AC2：オフラインでは変更を送らず、失敗を返す', async () => {
    const backend = fakeBackend()
    const ctl = new AppController(backend, newStore())
    await ctl.init()
    ctl.setOnline(false)
    expect(canEdit(ctl.getState())).toBe(false)
    const r = await ctl.applyChange({ type: 'set_quantity', lot_id: 'x', expected_updated_at: 'x', quantity: 1 })
    expect(r).toMatchObject({ ok: false, code: 'offline' })
    expect(backend.applyChange).not.toHaveBeenCalled()
  })

  it('保存失敗（競合）では成功を返さない', async () => {
    const backend = fakeBackend({ applyChange: vi.fn(async () => { throw new BackendError('conflict', '先に変更') }) })
    const ctl = new AppController(backend, newStore())
    await ctl.init()
    const r = await ctl.applyChange({ type: 'set_quantity', lot_id: 'x', expected_updated_at: 'x', quantity: 1 })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('AC7：スナップショットがなければ local は none（0件のスナップショットとは区別）', async () => {
    const ctl = new AppController(fakeBackend({ checkAuth: async () => ({ status: 'unreachable' }) }), newStore(), false)
    await ctl.init()
    expect(ctl.getState().local.status).toBe('none')
  })

  it('AC9：古い版（v1）の保存形式は移行して読み、未知の新しい版は使わない', () => {
    const snap = sampleSnapshot()
    const v1 = {
      key: 'k', localFormat: 1, userId: 'u', householdId: 'h', syncedAt: 'x',
      snapshot: { ...snap, lots: snap.lots.map(({ manufactured_value: _a, manufactured_precision: _b, shelf_life_months: _c, uses_per_unit: _d, expiry_kind: _e, ...l }) => l) },
    }
    const migrated = migrateStored(v1)
    expect(migrated?.localFormat).toBe(LOCAL_FORMAT)
    expect(migrated?.snapshot.lots[0]!.manufactured_value).toBeNull()
    expect(migrateStored({ ...v1, localFormat: LOCAL_FORMAT + 1 })).toBeNull()
  })

  it('AC9：未知の版が保存されていたら incompatible になる', async () => {
    const store = newStore()
    await store.save(USER, sampleSnapshot(), 'x')
    await store.raw.snapshots.toCollection().modify({ localFormat: 999 })
    const ctl = new AppController(fakeBackend({ checkAuth: async () => ({ status: 'unreachable' }) }), store, false)
    await ctl.init()
    expect(ctl.getState().local.status).toBe('incompatible')
  })
})

describe('004 ログイン状態と閲覧の分離', () => {
  it('AC3：オフラインでは認証を確かめなくても、保存済みの在庫を閲覧できる', async () => {
    const store = newStore()
    await store.save(USER, sampleSnapshot(), '2026-11-03T00:00:00Z')
    const backend = fakeBackend()
    const ctl = new AppController(backend, store, false)
    await ctl.init()
    expect(ctl.getState().local.status).toBe('ok')
    expect(ctl.getState().email).toBe(USER.email)
    expect(backend.checkAuth).not.toHaveBeenCalled()
    expect(canEdit(ctl.getState())).toBe(false)
  })

  it('AC4：オンラインでセッションが切れていたら、閲覧はそのまま・編集は不可・再ログインが必要', async () => {
    const store = newStore()
    await store.save(USER, sampleSnapshot(), '2026-11-03T00:00:00Z')
    const backend = fakeBackend()
    backend.auth = { status: 'needsReauth' }
    const ctl = new AppController(backend, store)
    await ctl.init()
    expect(ctl.getState()).toMatchObject({ auth: 'needsReauth', local: { status: 'ok' } })
    expect(canEdit(ctl.getState())).toBe(false)
    expect(backend.fetchSnapshot).not.toHaveBeenCalled()
  })

  it('008 AC4/AC5：ログアウトだけなら在庫は残り、消す場合は消える', async () => {
    const store = newStore()
    const ctl = new AppController(fakeBackend(), store)
    await ctl.init()
    await ctl.signOut(false)
    expect(ctl.getState().local.status).toBe('ok')
    expect((await store.load()).status).toBe('ok')
    await ctl.signOut(true)
    expect(ctl.getState().local.status).toBe('none')
    expect((await store.load()).status).toBe('none')
  })
})
