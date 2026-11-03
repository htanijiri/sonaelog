import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatDateTime } from '../../domain/dates'
import { exportCsv, exportJson, fileStamp } from '../../domain/exportData'
import { useApp } from '../../state/AppContext'
import { Dialog } from '../components/Dialog'
import { useToast } from '../components/Toast'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Settings() {
  const { state, ctl, snapshot, today } = useApp()
  const [confirmClear, setConfirmClear] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const stored = state.local.status === 'ok' ? state.local.stored : null

  const exportFile = (kind: 'json' | 'csv') => {
    if (!snapshot) return
    const now = new Date().toISOString()
    const name = `sonaelog-${fileStamp(now)}-同期${fileStamp(snapshot.captured_at)}.${kind}`
    if (kind === 'json') download(name, exportJson(snapshot, now), 'application/json')
    else download(name, exportCsv(snapshot, today), 'text/csv;charset=utf-8')
    toast('success', `${kind.toUpperCase()} を書き出しました`)
  }

  const signOut = async (clearLocal: boolean) => {
    await ctl.signOut(clearLocal)
    setConfirmClear(false)
    toast('success', clearLocal ? 'ログアウトし、この端末の在庫を消しました' : 'ログアウトしました（この端末の在庫は残っています）')
    if (clearLocal) navigate('/login', { replace: true })
  }

  const persist = state.persist
  return (
    <div className="stack">
      <h1 className="page-title">設定</h1>

      <section className="card" aria-labelledby="h-device">
        <h2 id="h-device">この端末</h2>
        <dl className="facts">
          <dt>ログイン</dt>
          <dd data-testid="settings-email">{state.email ?? '—'}{state.auth !== 'signedIn' && state.email ? '（ログインしていません）' : ''}</dd>
          <dt>在庫の保存</dt>
          <dd>{stored ? `保存済み（最終同期：${formatDateTime(stored.syncedAt)}）` : '未保存'}</dd>
          {snapshot && (
            <>
              <dt>保存している内容</dt>
              <dd data-testid="settings-counts">
                明細 {snapshot.lots.length} 件・保管場所 {snapshot.locations.length} か所
              </dd>
            </>
          )}
          <dt>永続保存</dt>
          <dd data-testid="persist-status">
            {!persist ? '未申請' : !persist.supported ? '未対応のブラウザ' : persist.granted ? '許可された' : '許可されなかった'}
          </dd>
          <dt>アプリの版</dt>
          <dd>{__APP_VERSION__}</dd>
        </dl>
        <p className="muted small">
          「永続保存」が許可されると、端末の空き容量が少なくなってもブラウザが在庫データを自動で消しにくくなります。許可されなくても使えますが、消える可能性が少し高くなります。
        </p>
        {state.online && state.auth === 'signedIn' && (
          <button type="button" className="btn" onClick={() => void ctl.syncNow()} disabled={state.sync === 'syncing'}>
            今すぐ同期
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="h-backup">
        <h2 id="h-backup">バックアップの書き出し</h2>
        <p className="muted small">この端末に保存済みの在庫から作るので、オフラインでも書き出せます。</p>
        <div className="action-grid">
          <button type="button" className="btn" disabled={!snapshot} onClick={() => exportFile('json')}>
            JSON で書き出す
          </button>
          <button type="button" className="btn" disabled={!snapshot} onClick={() => exportFile('csv')}>
            CSV で書き出す（表計算ソフト用）
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="h-lost">
        <h2 id="h-lost">この端末のデータが消える場合</h2>
        <ul className="plain small">
          <li>ブラウザの「閲覧データの削除」でサイトのデータを消したとき</li>
          <li>アプリ（ホーム画面のアイコン）やブラウザを削除したとき、機種変更したとき</li>
          <li>長い間アプリを開かなかったとき、端末の空き容量が足りなくなったとき（ブラウザが自動で消すことがあります）</li>
        </ul>
        <p className="small">消えても、ネットにつないでログインすれば元に戻ります。災害に備えて、ときどきバックアップを書き出しておいてください。</p>
      </section>

      <section className="card" aria-labelledby="h-logout">
        <h2 id="h-logout">ログアウト</h2>
        <div className="action-grid">
          <button type="button" className="btn" onClick={() => void signOut(false)}>
            ログアウトだけ（在庫は残す）
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
            ログアウトして、この端末の在庫も消す
          </button>
        </div>
      </section>

      {confirmClear && (
        <Dialog title="この端末の在庫を消す" onClose={() => setConfirmClear(false)}>
          <p>ログアウトして、この端末に保存した在庫を消します。消すと、ネットにつないでログインするまで在庫を見られなくなります。</p>
          <p className="muted small">クラウドの在庫は消えません。</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
              やめる
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void signOut(true)}>
              消してログアウト
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
