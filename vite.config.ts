import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }
import { demoApiPlugin } from './demo/server'

export default defineConfig(({ command, mode }) => {
  // 疑似クラウドは開発サーバー（npm run dev）と E2E 用ビルド（--mode e2e）だけで使う。本番ビルドには入らない
  const demo = (command === 'serve' && process.env.VITE_DEMO === '1') || mode === 'e2e'
  const plugins: PluginOption[] = [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // 開発サーバーでは Service Worker を使わない（オフライン試験は E2E 用ビルドで行う）
      devOptions: { enabled: false },
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'sonaelog 防災備蓄',
        short_name: 'sonaelog',
        description: '家族の防災備蓄を、オフラインでも検索・閲覧できる台帳',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f6f2',
        theme_color: '#1f4e5f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリの画面（HTML・JS・CSS・アイコン）だけを事前にキャッシュする。
        // Supabase の API 応答や認証トークンは Cache Storage に入れない（runtimeCaching を設定しない）
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: demo ? [/^\/__demo_api\//] : [],
        cleanupOutdatedCaches: true,
        // 初回に開いたページもすぐ Service Worker の制御下に入れる。
        // これがないと「ログインしてすぐ機内モード」にしたとき、再読み込みするまでオフラインで開けない
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ]
  if (demo) plugins.push(demoApiPlugin())
  return {
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      ...(mode === 'e2e' ? { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } : {}),
    },
    build: { sourcemap: false },
  }
})
