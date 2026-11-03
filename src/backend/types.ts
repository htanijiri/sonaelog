// データの出入り口。本番は Supabase、開発は疑似クラウド（デモモード）。画面はこの型だけを使う。

import type { Change } from '../domain/changes'

export interface AuthUser {
  id: string
  email: string
}

/**
 * クラウド側から見たログイン状態。
 * - signedIn：有効なセッションがある
 * - needsReauth：通信はできたが、セッションが切れている・失効している
 * - signedOut：この端末にセッションがない
 * - unreachable：通信できず確かめられない（オフラインなど）。閲覧は止めない
 */
export type AuthCheck =
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'needsReauth' }
  | { status: 'signedOut' }
  | { status: 'unreachable' }

export type BackendErrorCode =
  | 'offline'
  | 'auth'
  | 'conflict'
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'unknown'

export class BackendError extends Error {
  constructor(
    public code: BackendErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

export interface Backend {
  kind: 'supabase' | 'demo'
  checkAuth(): Promise<AuthCheck>
  signIn(email: string, password: string): Promise<AuthUser>
  /** この端末のセッションを消す。オフラインでも端末内のセッションは必ず消える */
  signOut(): Promise<void>
  /** 家庭の完全なスナップショットを取得する。検証は呼び出し側で行う */
  fetchSnapshot(): Promise<unknown>
  applyChange(change: Change): Promise<void>
}

/** fetch の失敗を「オフライン」として扱うかどうか */
export function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /fetch|network|Failed to/i.test(e.message))
}
