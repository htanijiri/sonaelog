import { describe, expect, it, vi } from 'vitest'
import worker, { ping } from '../worker/index'

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }

describe('009 休止防止の Worker', () => {
  it('ping RPC を公開キーで呼び、true を確かめる', async () => {
    const fetcher = vi.fn(async () => new Response('true', { status: 200 }))
    await expect(ping(env, fetcher as unknown as typeof fetch)).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith('https://example.supabase.co/rest/v1/rpc/ping', expect.objectContaining({ method: 'POST' }))
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test')
  })
  it('失敗したら例外にする（Cloudflare のログに残す）', async () => {
    const fetcher = vi.fn(async () => new Response('{"message":"paused"}', { status: 503 }))
    await expect(ping(env, fetcher as unknown as typeof fetch)).rejects.toThrow(/503/)
  })
  it('静的アセット以外のリクエストは 404', async () => {
    expect((await worker.fetch()).status).toBe(404)
  })
})
