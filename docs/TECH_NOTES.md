# 技術ノート：sonaelog

実装してわかったこと・ハマったことを、あとで記事や別プロジェクトで使える形で残す。
仕様書が完了したら、得られた知見をここに還元する。

## 1. 技術選定
| 領域 | 選んだもの | 理由 | 選ばなかったもの |
|---|---|---|---|
| UI | React + TypeScript + Vite | BRIEF の推奨。PWA プラグインが充実 | — |
| スタイル | 素の CSS（CSS Modules） | 画面数が少なく、プリキャッシュを軽くしたい | Tailwind、UI ライブラリ |
| PWA | vite-plugin-pwa（generateSW） | アプリシェルのプリキャッシュを宣言的に書ける。runtimeCaching は使わない | 手書きの Service Worker |
| ローカル保存 | IndexedDB（Dexie） | トランザクションと移行（版管理）が扱いやすい | localStorage（容量・原子性）、Cache Storage（API 応答を入れない方針） |
| DB・認証 | Supabase（PostgreSQL・Auth・RLS）無料プラン | BRIEF の推奨。家庭への所属を DB 側で強制できる | Cloudflare D1（RLS がない） |
| 休止防止 | Cloudflare Worker の cron（配信と同じ Worker） | 無料。GitHub Actions の定期実行はリポジトリが60日更新されないと止まる | GitHub Actions |
| ホスティング | Cloudflare Workers の静的アセット＋独自ドメイン | `routes` の `custom_domain: true` で、デプロイだけで DNS と証明書が作られる。cron も同居できる | Cloudflare Pages（BRIEF の推奨だが、独自ドメインの追加が CLI でできない） |
| DB のテスト | PGlite（WASM の PostgreSQL） | Docker なしで同じマイグレーションと RLS を検証でき、本番にテストデータを入れずに済む | ローカル Supabase（Docker 未導入）、本番での検証 |
| 画面のテスト | Playwright ＋ 開発サーバーの疑似クラウド | 複数ブラウザが同じ疑似クラウドを共有し、2端末同期とオフライン再起動を再現できる | ブラウザ内だけのモック |
| 期限計算 | Intl（Asia/Tokyo）＋整数の日付計算 | 必要なのは日付比較だけ。`Date` のタイムゾーンずれを避ける | date-fns-tz、Temporal polyfill |
| ログイン | メールアドレス＋パスワード | アプリ内で完結。Supabase 標準のメール送信は制限が厳しい | マジックリンク、OTP、OAuth |

## 2. アーキテクチャ
<!-- 構成とデータの流れ -->

## 3. ハマりどころと対処
<!-- 症状 → 原因 → 対処 の順で書く。CLAUDE.md の「消してはいけない設定」の理由はここに書く -->

## 4. 「効かなかったこと」リスト
<!-- 試したがうまくいかなかったこと。同じ失敗を繰り返さないために書く -->

## 5. 今後の課題
