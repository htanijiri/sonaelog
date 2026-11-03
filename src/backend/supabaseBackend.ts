// 本番の Backend。Supabase の Auth と RPC（get_household_snapshot / apply_change）だけを使う。
// テーブルへの直接の読み書きはしない（変更・監査記録・楽観ロックを DB の関数で一括して保証するため）。

import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import type { Change } from '../domain/changes'
import { BackendError, type AuthCheck, type Backend, type BackendErrorCode } from './types'

const STORAGE_KEY = 'sonaelog-auth'

/** DB の関数が raise する独自の SQLSTATE（supabase/migrations の apply_change と揃える） */
const SQLSTATE_TO_CODE: Record<string, BackendErrorCode> = {
  SL409: 'conflict',
  SL400: 'validation',
  SL404: 'not_found',
  SL403: 'forbidden',
  PGRST301: 'auth',
  PGRST303: 'auth',
  '42501': 'forbidden',
}

function toBackendError(error: { code?: string; message: string; status?: number }): BackendError {
  if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
    return new BackendError('offline', '通信できませんでした')
  }
  const mapped = error.code ? SQLSTATE_TO_CODE[error.code] : undefined
  const code: BackendErrorCode = mapped ?? (error.status === 401 ? 'auth' : 'unknown')
  return new BackendError(code, error.message)
}

export function createSupabaseBackend(url: string, publishableKey: string): Backend {
  const client: SupabaseClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY },
  })

  const offline = () => typeof navigator !== 'undefined' && !navigator.onLine

  return {
    kind: 'supabase',

    async checkAuth(): Promise<AuthCheck> {
      if (!localStorage.getItem(STORAGE_KEY)) return { status: 'signedOut' }
      if (offline()) return { status: 'unreachable' }
      const { data, error } = await client.auth.getUser()
      if (error) {
        if (isAuthRetryableFetchError(error) || /fetch/i.test(error.message)) return { status: 'unreachable' }
        return { status: 'needsReauth' }
      }
      return { status: 'signedIn', user: { id: data.user.id, email: data.user.email ?? '' } }
    },

    async signIn(email, password) {
      if (offline()) throw new BackendError('offline', 'オフラインです')
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) {
        if (isAuthRetryableFetchError(error)) throw new BackendError('offline', '通信できませんでした')
        throw new BackendError('auth', 'メールアドレスかパスワードが違います')
      }
      return { id: data.user.id, email: data.user.email ?? '' }
    },

    async signOut() {
      // 'local' はこの端末のセッションだけを消す。通信に失敗しても端末内のセッションは消えるが、念のため直接も消す
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
      localStorage.removeItem(STORAGE_KEY)
    },

    async fetchSnapshot() {
      if (offline()) throw new BackendError('offline', 'オフラインです')
      const { data, error } = await client.rpc('get_household_snapshot')
      if (error) throw toBackendError(error)
      return data
    },

    async applyChange(change: Change) {
      if (offline()) throw new BackendError('offline', 'オフラインです')
      const { error } = await client.rpc('apply_change', { p_change: change })
      if (error) throw toBackendError(error)
    },
  }
}
