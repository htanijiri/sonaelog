// デモモードの Backend。開発サーバーの疑似クラウド（demo/server.ts）と通信する。
// セッションの持ち方とトークン更新の失敗の仕方を Supabase に似せて、ログイン切れの動作を試せるようにしている。

import type { Change } from '../domain/changes'
import { BackendError, isNetworkFailure, type AuthCheck, type AuthUser, type Backend } from './types'

const SESSION_KEY = 'sonaelog-demo-session'
const BASE = '/__demo_api'

interface DemoSession {
  access_token: string
  refresh_token: string
  expires_at: number
  user: AuthUser
}

function loadSession(): DemoSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as DemoSession) : null
  } catch {
    return null
  }
}

function saveSession(s: DemoSession | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new BackendError('offline', 'オフラインです')
  }
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch (e) {
    if (isNetworkFailure(e)) throw new BackendError('offline', '通信できませんでした')
    throw e
  }
}

async function errorFrom(res: Response): Promise<BackendError> {
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
  const code = res.status === 401 ? 'auth' : res.status === 409 ? 'conflict' : (body.code as BackendError['code']) ?? 'unknown'
  return new BackendError(code, body.message ?? `エラー（${res.status}）`)
}

export function createDemoBackend(): Backend {
  /** 期限が近ければ更新して、使えるアクセストークンを返す */
  async function validToken(): Promise<string> {
    const s = loadSession()
    if (!s) throw new BackendError('auth', 'ログインが必要です')
    if (s.expires_at * 1000 > Date.now() + 30_000) return s.access_token
    const res = await call('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) })
    if (!res.ok) throw await errorFrom(res)
    const next = (await res.json()) as DemoSession
    saveSession(next)
    return next.access_token
  }

  return {
    kind: 'demo',

    async checkAuth(): Promise<AuthCheck> {
      const s = loadSession()
      if (!s) return { status: 'signedOut' }
      try {
        const token = await validToken()
        const res = await call('/auth/user', {}, token)
        if (res.status === 401) return { status: 'needsReauth' }
        if (!res.ok) return { status: 'unreachable' }
        return { status: 'signedIn', user: (await res.json()) as AuthUser }
      } catch (e) {
        if (e instanceof BackendError && e.code === 'auth') return { status: 'needsReauth' }
        return { status: 'unreachable' }
      }
    },

    async signIn(email, password) {
      const res = await call('/auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (!res.ok) throw await errorFrom(res)
      const s = (await res.json()) as DemoSession
      saveSession(s)
      return s.user
    },

    async signOut() {
      saveSession(null)
    },

    async fetchSnapshot() {
      const res = await call('/snapshot', {}, await validToken())
      if (!res.ok) throw await errorFrom(res)
      return res.json()
    },

    async applyChange(change: Change) {
      const res = await call('/change', { method: 'POST', body: JSON.stringify(change) }, await validToken())
      if (!res.ok) throw await errorFrom(res)
    },
  }
}
