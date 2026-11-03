import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { IS_DEMO } from '../../backend'
import { BackendError } from '../../backend/types'
import { useApp } from '../../state/AppContext'

export function Login() {
  const { ctl, state, snapshot } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState(state.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await ctl.signIn(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof BackendError && err.code === 'offline'
          ? 'オフラインのためログインできません。ネットにつないでからやり直してください'
          : err instanceof BackendError && err.code === 'auth'
            ? 'メールアドレスかパスワードが違います'
            : 'ログインできませんでした',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack form login" onSubmit={(e) => void submit(e)}>
      <h1 className="page-title">sonaelog 防災備蓄</h1>
      <p>家族のアカウントでログインしてください。ログインすると在庫がこの端末に保存され、以後はオフラインでも見られます。</p>
      {state.auth === 'needsReauth' && <p className="notice notice-warn">ログインの有効期限が切れました。もう一度ログインしてください。</p>}
      {!state.online && <p className="notice notice-warn">オフラインです。ログインにはネット接続が必要です。</p>}
      <label className="field">
        <span>メールアドレス</span>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>パスワード</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !state.online}>
        ログイン
      </button>
      {snapshot && <Link to="/">ログインせずに、保存済みの在庫を見る</Link>}
      {IS_DEMO && (
        <p className="notice small" data-testid="demo-hint">
          デモモード（開発用の疑似クラウド）です。架空のアカウント a@example.test / demo-pass-a、b@example.test / demo-pass-b でログインできます。
        </p>
      )}
      <p className="muted small">アカウントの追加・パスワードの再設定は、管理用の手順で行います（この画面からの新規登録はできません）。</p>
    </form>
  )
}
