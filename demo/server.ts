// 開発用の「疑似クラウド」。Vite の開発サーバー・preview サーバーに /__demo_api を足す。
// メモリ上の1家庭分のデータを、同じサーバーにつないだすべてのブラウザで共有する
// （E2E で「家族A が追加 → 家族B が同期」を再現するため）。本番のビルドには入らない。

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import {
  applyChangeToState,
  ChangeError,
  stateToSnapshot,
  type Change,
  type HouseholdState,
} from '../src/domain/changes'
import { seedToRows, validateSeed } from '../src/domain/seed'

export const DEMO_USERS = [
  { id: '00000000-0000-4000-8000-00000000000a', email: 'a@example.test', password: 'demo-pass-a' },
  { id: '00000000-0000-4000-8000-00000000000b', email: 'b@example.test', password: 'demo-pass-b' },
]

/** 疑似クラウドのアクセストークンの有効期間（秒）。期限切れの再現は /__control で行う */
const TOKEN_TTL_SEC = 3600

interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  user_id: string
}

interface Control {
  /** 次の n 回のスナップショット取得を 500 で失敗させる */
  failSnapshot: number
  /** 次の n 回のスナップショット取得で壊れたデータを返す */
  corruptSnapshot: number
  /** 応答を遅らせる（ミリ秒） */
  delayMs: number
}

function loadState(dataPath: string): HouseholdState {
  const raw = JSON.parse(readFileSync(dataPath, 'utf8'))
  const result = validateSeed(raw)
  if (!result.ok || !result.data) {
    throw new Error(`デモデータの検証に失敗しました（${dataPath}）:\n${result.errors.join('\n')}`)
  }
  const now = new Date().toISOString()
  const { locations, lots } = seedToRows(result.data, randomUUID, now)
  return {
    household_id: '00000000-0000-4000-8000-0000000000f1',
    household_name: 'デモの家',
    revision: 1,
    locations: locations.map((l) => ({ ...l, archived_at: null })),
    lots: lots.map((l) => ({ ...l, archived_at: null, archive_reason: null })),
    events: [],
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

export function demoApiPlugin(options: { dataPath?: string } = {}): Plugin {
  const dataPath = resolve(options.dataPath ?? process.env.DEMO_DATA ?? 'fixtures/sample-data.json')
  let state = loadState(dataPath)
  let sessions = new Map<string, Session>()
  let control: Control = { failSnapshot: 0, corruptSnapshot: 0, delayMs: 0 }

  const issue = (user_id: string): Session => {
    const s: Session = {
      access_token: randomUUID(),
      refresh_token: randomUUID(),
      expires_at: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
      user_id,
    }
    sessions.set(s.access_token, s)
    return s
  }
  const authed = (req: IncomingMessage): Session | null => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const s = sessions.get(token)
    if (!s || s.expires_at * 1000 < Date.now()) return null
    return s
  }
  const sessionBody = (s: Session) => {
    const user = DEMO_USERS.find((u) => u.id === s.user_id)!
    return { ...s, user: { id: user.id, email: user.email } }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/__demo_api/')) return next()
    const route = `${req.method} ${url.pathname.slice('/__demo_api'.length)}`
    if (control.delayMs) await new Promise((r) => setTimeout(r, control.delayMs))
    try {
      switch (route) {
        case 'POST /auth/sign-in': {
          const { email, password } = (await readBody(req)) as { email?: string; password?: string }
          const user = DEMO_USERS.find((u) => u.email === email && u.password === password)
          if (!user) return send(res, 400, { code: 'auth', message: 'メールアドレスかパスワードが違います' })
          return send(res, 200, sessionBody(issue(user.id)))
        }
        case 'POST /auth/refresh': {
          const { refresh_token } = (await readBody(req)) as { refresh_token?: string }
          const old = [...sessions.values()].find((s) => s.refresh_token === refresh_token)
          if (!old) return send(res, 401, { code: 'auth', message: 'セッションが失効しています' })
          sessions.delete(old.access_token)
          return send(res, 200, sessionBody(issue(old.user_id)))
        }
        case 'GET /auth/user': {
          const s = authed(req)
          if (!s) return send(res, 401, { code: 'auth', message: 'ログインが必要です' })
          return send(res, 200, sessionBody(s).user)
        }
        case 'GET /snapshot': {
          if (!authed(req)) return send(res, 401, { code: 'auth', message: 'ログインが必要です' })
          if (control.failSnapshot > 0) {
            control.failSnapshot -= 1
            return send(res, 500, { code: 'unknown', message: '疑似クラウドの障害（テスト用）' })
          }
          const snapshot = stateToSnapshot(state, new Date().toISOString())
          if (control.corruptSnapshot > 0) {
            control.corruptSnapshot -= 1
            return send(res, 200, { ...snapshot, lots: snapshot.lots.map((l) => ({ ...l, location_id: 'missing' })) })
          }
          return send(res, 200, snapshot)
        }
        case 'POST /change': {
          const s = authed(req)
          if (!s) return send(res, 401, { code: 'auth', message: 'ログインが必要です' })
          const change = (await readBody(req)) as Change
          applyChangeToState(state, change, { actor: s.user_id, now: new Date().toISOString(), newId: randomUUID })
          return send(res, 200, { ok: true, revision: state.revision })
        }
        // ---- テスト用の操作 ----
        case 'POST /__control': {
          const body = (await readBody(req)) as Partial<Control> & { reset?: boolean; expireTokens?: boolean; revokeAll?: boolean }
          if (body.reset) {
            state = loadState(dataPath)
            sessions = new Map()
            control = { failSnapshot: 0, corruptSnapshot: 0, delayMs: 0 }
          }
          if (body.expireTokens) for (const s of sessions.values()) s.expires_at = 0
          if (body.revokeAll) sessions = new Map()
          control = { ...control, ...Object.fromEntries(Object.entries(body).filter(([k]) => k in control)) }
          return send(res, 200, { ok: true })
        }
        case 'GET /__events':
          return send(res, 200, state.events)
        default:
          return send(res, 404, { code: 'not_found', message: route })
      }
    } catch (e) {
      if (e instanceof ChangeError) return send(res, e.code === 'conflict' ? 409 : 400, { code: e.code, message: e.message })
      return send(res, 500, { code: 'unknown', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    name: 'sonaelog-demo-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
  }
}
