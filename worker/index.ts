// Cloudflare Worker。アプリの画面（dist/ の静的ファイル）は Workers の静的アセットとして配信され、このコードを通らない。
// このコードの役目は、Supabase の無料プロジェクトが「1週間アクセスなし」で休止しないよう、定期的に ping することだけ。

interface Env {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}

export async function ping(env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/ping`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const body = await res.text()
  if (!res.ok || body.trim() !== 'true') throw new Error(`ping に失敗しました（${res.status}）：${body.slice(0, 200)}`)
  return true
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await ping(env)
    console.log('Supabase への ping に成功しました')
  },
  // 静的アセットに当たらなかったリクエスト（SPA のフォールバックは assets 側で処理されるので、通常ここには来ない）
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 })
  },
}
