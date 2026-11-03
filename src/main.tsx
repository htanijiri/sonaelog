import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { createBackend } from './backend'
import { SnapshotStore } from './local/snapshotStore'
import { AppProvider } from './state/AppContext'
import { AppController } from './state/controller'
import { App } from './ui/App'
import './ui/styles.css'

// アプリの画面を端末に保存する Service Worker。新しい版は自動で入れ替わる
registerSW({ immediate: true })

async function start() {
  const root = createRoot(document.getElementById('root')!)
  try {
    const backend = await createBackend()
    const controller = new AppController(backend, new SnapshotStore())
    window.addEventListener('online', () => controller.setOnline(true))
    window.addEventListener('offline', () => controller.setOnline(false))
    // アプリが前面に戻ったら同期する（ほかの家族の変更を取り込む）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void controller.syncNow()
    })
    root.render(
      <StrictMode>
        <AppProvider controller={controller}>
          <App />
        </AppProvider>
      </StrictMode>,
    )
    await controller.init()
  } catch (e) {
    root.render(<p style={{ padding: 16 }}>起動できませんでした：{e instanceof Error ? e.message : String(e)}</p>)
  }
}

void start()
