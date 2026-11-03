import { Link } from 'react-router'
import { formatDateTime } from '../../domain/dates'
import { useApp } from '../../state/AppContext'

/** 画面上部の帯：端末に保存済みか・最終同期日時・オンライン／オフライン／同期失敗 */
export function StatusBar() {
  const { state, ctl } = useApp()
  const stored = state.local.status === 'ok' ? state.local.stored : null

  const network = !state.online
    ? { cls: 'is-offline', text: 'オフライン' }
    : state.sync === 'failed'
      ? { cls: 'is-failed', text: '同期失敗' }
      : state.sync === 'syncing'
        ? { cls: 'is-syncing', text: '同期中…' }
        : { cls: 'is-online', text: 'オンライン' }

  return (
    <header className="statusbar" aria-label="同期の状態">
      <div className="status-row">
        <span className={`status-pill ${stored ? 'is-saved' : 'is-unsaved'}`} data-testid="local-status">
          {stored
            ? `この端末に保存済み（最終同期：${formatDateTime(stored.syncedAt)}）`
            : '未保存（オフラインでは使用不可）'}
        </span>
        <span className={`status-pill ${network.cls}`} data-testid="network-status">
          {network.text}
        </span>
        {state.online && state.auth === 'signedIn' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void ctl.syncNow()}
            disabled={state.sync === 'syncing'}
          >
            今すぐ同期
          </button>
        )}
      </div>
      {stored && state.sync === 'failed' && !state.localStale && (
        <p className="status-note" role="status">
          {state.syncMessage ?? '同期に失敗しました'}。表示しているのは最終同期時点の情報です。
        </p>
      )}
      {state.localStale && (
        <p className="status-note status-warn" role="alert">
          クラウドには保存済み・この端末は未更新です。
          <button type="button" className="btn btn-small" onClick={() => void ctl.syncNow()}>
            再同期
          </button>
        </p>
      )}
      {stored && !state.online && (
        <p className="status-note" role="status">
          オフラインのため閲覧のみです（編集できません）。
        </p>
      )}
      {stored && state.online && (state.auth === 'needsReauth' || state.auth === 'signedOut') && (
        <p className="status-note status-warn" role="alert">
          {state.auth === 'needsReauth' ? 'ログインの有効期限が切れました。' : 'ログインしていません。'}
          表示しているのは最終同期時点の情報で、編集するには再ログインが必要です。
          <Link to="/login" className="btn btn-small">
            ログイン
          </Link>
        </p>
      )}
    </header>
  )
}
