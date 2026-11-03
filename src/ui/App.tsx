import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import { useApp } from '../state/AppContext'
import { StatusBar } from './components/StatusBar'
import { ToastProvider } from './components/Toast'
import { Home } from './pages/Home'
import { ItemDetail } from './pages/ItemDetail'
import { ItemForm } from './pages/ItemForm'
import { Items } from './pages/Items'
import { LocationDetail } from './pages/LocationDetail'
import { Locations } from './pages/Locations'
import { Login } from './pages/Login'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  )
}

const NAV = [
  { to: '/', label: 'ホーム', icon: '⌂' },
  { to: '/items', label: '在庫', icon: '☰' },
  { to: '/locations', label: '保管場所', icon: '▦' },
  { to: '/review', label: '要確認', icon: '✓' },
  { to: '/settings', label: '設定', icon: '⚙' },
]

function Shell() {
  const { state, snapshot } = useApp()
  const location = useLocation()

  if (location.pathname === '/login') {
    return (
      <div className="app">
        <main className="main">
          <Login />
        </main>
      </div>
    )
  }

  let content: React.ReactNode
  if (state.local.status === 'loading') {
    content = <p className="center muted">読み込み中…</p>
  } else if (!snapshot) {
    content = <NoLocalData />
  } else {
    content = (
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/items" element={<Items />} />
        <Route path="/items/new" element={<ItemForm />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/items/:id/edit" element={<ItemForm />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/review" element={<Review />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  return (
    <div className="app">
      <StatusBar />
      <main className="main">{content}</main>
      {snapshot && (
        <nav className="tabbar" aria-label="メイン">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="tab">
              <span aria-hidden="true" className="tab-icon">
                {n.icon}
              </span>
              <span>{n.label}</span>
              {n.to === '/review' && snapshot.lots.some((l) => l.needs_review) && (
                <span className="tab-dot" aria-label="要確認あり" />
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}

/** 端末に在庫が保存されていないとき。「在庫 0 件」とは表示しない */
function NoLocalData() {
  const { state } = useApp()
  if (state.local.status === 'incompatible') {
    return (
      <section className="notice notice-warn" role="alert">
        <h1>再同期が必要です</h1>
        <p>この端末に保存されている在庫は、古い（または新しい）版のアプリの形式で、このままでは読めません。</p>
        {state.online ? (
          state.auth === 'signedIn' ? (
            <p>クラウドから読み込み直しています…</p>
          ) : (
            <Navigate to="/login" replace />
          )
        ) : (
          <p>ネットにつないでアプリを開き直してください。</p>
        )}
      </section>
    )
  }
  if (!state.online) {
    return (
      <section className="notice notice-warn" role="alert">
        <h1>この端末にはまだ在庫が保存されていません</h1>
        <p>オフラインでは在庫を表示できません。ネットにつないでログインすると、在庫がこの端末に保存され、以後はオフラインでも見られます。</p>
        <p className="muted">在庫が 0 件という意味ではありません。</p>
      </section>
    )
  }
  if (state.auth === 'signedOut' || state.auth === 'needsReauth') return <Navigate to="/login" replace />
  if (state.sync === 'failed') {
    return (
      <section className="notice notice-error" role="alert">
        <h1>在庫を読み込めませんでした</h1>
        <p>{state.syncMessage}</p>
        <p className="muted">この端末にはまだ在庫が保存されていません（在庫が 0 件という意味ではありません）。</p>
      </section>
    )
  }
  return <p className="center muted">クラウドから在庫を読み込んでいます…</p>
}
