import { createSupabaseBackend } from './supabaseBackend'
import type { Backend } from './types'

/** デモモードかどうか。開発サーバー（または E2E 用ビルド）で VITE_DEMO=1 のときだけ true */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1' && (import.meta.env.DEV || import.meta.env.MODE === 'e2e')

export async function createBackend(): Promise<Backend> {
  if (IS_DEMO) {
    // 本番ビルドでは IS_DEMO が false に確定するので、この import ごと消える
    const { createDemoBackend } = await import('./demoBackend')
    return createDemoBackend()
  }
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase の接続先（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）が設定されていません')
  return createSupabaseBackend(url, key)
}
