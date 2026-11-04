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
```
[Android の PWA]                                    [Supabase（正本）]
  画面（React） ── AppController ── Backend ──RPC──▶ get_household_snapshot()  ← RLS（家庭への所属）
                       │                    ──RPC──▶ apply_change()（security invoker、1トランザクション）
                       ▼
                 IndexedDB（Dexie）                  [Cloudflare Worker]
                 家庭の完全なスナップショット1件          静的アセット配信（sonaelog.tanijiri.dev）
                                                      cron 3日に1回 → ping()（休止防止）
  Service Worker：アプリの画面だけをプリキャッシュ（API 応答は入れない）
```
- **読み取り**：起動時・前面に戻ったとき・「今すぐ同期」・オンライン復帰時に、`get_household_snapshot()` で家庭の全データを1回で取得 → zod で検証 → IndexedDB に1レコードとして put（原子的に置き換え）→ 画面は IndexedDB の内容を表示。検証や保存に失敗したら前回分を表示し続ける。
- **書き込み**：オンラインかつログイン済みのときだけ `apply_change()` を呼ぶ。成功したらスナップショットを取り直して保存。保存に失敗したら「クラウドには保存済み・この端末は未更新」。
- **閲覧の可否**は「端末に保存済みか」だけで決める。ログイン状態（signedIn／needsReauth／signedOut）は編集の可否にだけ使う。
- **期限判定**は端末で、日本時間の今日と期限文字列から毎回計算（`src/domain/expiry.ts`）。製造年月からの期限も保存せずに計算する。
- **開発用の疑似クラウド**（`demo/server.ts`）は `src/domain/changes.ts` の同じ規則で変更を処理する。SQL 版（`apply_change`）と同じ挙動であることを、同じ観点のテスト（`tests/domain/changes.test.ts` と `tests/db/changes.test.ts`）で確かめる。

## 3. ハマりどころと対処
### 初回のページが Service Worker の制御下に入らない（vite-plugin-pwa 2.0）
- 症状：ログイン直後にオフラインにして再読み込みすると、ブラウザのオフライン画面になる。2回目以降の起動では問題ない。
- 原因：Service Worker は activated になっていたが、`navigator.serviceWorker.controller` が null のまま（再読み込みで初めて制御下に入る）。vite-plugin-pwa 2.0 の `generateSW` では `clientsClaim` が既定で有効でない。
- 対処：workbox に `clientsClaim: true`・`skipWaiting: true` を明示。E2E の待ち合わせも「activated」ではなく「controller がある」まで待つ。

### `sw.js` に開発用のパスが入る
- 症状：`check:bundle` が `dist/sw.js` の `__demo_api` を検出。
- 原因：`navigateFallbackDenylist` に疑似クラウドのパスを常に書いていた。
- 対処：デモビルドのときだけ設定する。

### 内部用の SQL 関数が API から呼べてしまう
- 症状（設計時に気づいた）：`public` スキーマの関数は PostgREST の `/rpc/` で呼べる。
- 対処：`_insert_lot` などの内部関数を `private` スキーマに移し、`authenticated` には USAGE と EXECUTE だけを与える。テストで「public に `_` で始まる関数がない」ことを確認。

### Supabase の「public のテーブルは既定で anon に公開」
- 対処：マイグレーションの先頭で `alter default privileges ... revoke ... from anon` し、作ったテーブルにも明示的に revoke。PGlite のテスト環境では Supabase と同じ既定の GRANT を再現してから流し、revoke が効いていることを確かめる。

### Playwright でのオフライン試験
- `context.setOffline(true)` は送信済みのリクエストを止めない。「送信中に切断」は `page.route(...).abort('internetdisconnected')` で再現する。
- `page.goto` は起動時の同期を走らせる（アプリとして正しい動き）。「同期前は古いまま」を確かめるときは画面内のリンクで移動する。
- アクセシブルネームの部分一致：`name: '年月'` は「年月日」にも一致する。`exact: true` を付ける。

### Supabase CLI 3.0
- `supabase config push` は config.toml に書いた項目だけを反映する（書いていない項目は変えない）ので、最小限の config.toml で済む。
- 非対話の実行では `--yes`（または `SUPABASE_YES`）が必要。
- `link` と `db push --remote` は、ログイン済みのアクセストークンで一時的なログインロールを作るので、データベースのパスワードは要らなかった。
- `[auth.email] enable_signup` は非推奨の警告が出る。警告は `auth.email.enabled` を勧めるが、これを false にするとメールのログインそのものが止まる。新規登録の停止は `[auth] enable_signup = false` だけで足り、`/auth/v1/signup` が `signup_disabled` を返すことを確認した。
- 新しく作ったアカウントには、既定のプロジェクトが自動で1つ作られることがある（無料枠の1つを使う。リージョンも東京とは限らない）。

### CLI がどのアカウントでログインしているか
- Supabase も Cloudflare も、CLI のログインは端末全体で1つ。以前に別の（仕事用など）アカウントでログインしていると、そのまま別アカウントにプロジェクトや Worker を作ってしまう。
- 実際に、Cloudflare の CLI が別アカウントのままで `wrangler deploy` し、Worker のアップロード後に独自ドメインの設定で失敗した（`Can't infer zone from route … [code: 10082]`：そのアカウントにゾーンがない）。
- 作成・デプロイの前に、`wrangler whoami` のアカウント名と、ゾーン API（`/client/v4/zones?name=<ドメイン>`）で対象のドメインが見えることを確かめる。Supabase は `supabase orgs list` で組織を確かめる。
- ブラウザ側も前のアカウントでログインしていると、OAuth の承認がそのアカウントで通ってしまう。ログインの前にブラウザのアカウントを切り替えてもらう。

### バンドル検査の誤検知（supabase-js の接頭辞判定）
- `check:bundle` で `sb_secret_` という文字列を探していたら、supabase-js が鍵の種類を判定する `e.startsWith('sb_secret_')` に反応して、CI とデプロイが止まった（本物の鍵は入っていなかった）。
- 「接頭辞のあとに鍵の本体（16文字以上）が続くもの」を正規表現で探すように変更。`.env` の鍵そのものとの完全一致の検査は残している。

### Cloudflare Web Analytics のビーコン
- tanijiri.dev のゾーンで Web Analytics の自動挿入が有効なため、配信した HTML に `static.cloudflareinsights.com` のスクリプトが挿入される。CSP（`script-src 'self'`）で読み込みが止まり、コンソールにエラーが1件出るが、解析データは送られないので、そのままにしている。

### Workers の SPA フォールバック
- `not_found_handling: single-page-application` は、ブラウザの画面遷移（`Sec-Fetch-Mode: navigate`）のときだけ `index.html` を返す。curl で `/items` を開くと 404 になるが、ブラウザでは 200。確認するときはヘッダを付ける。

### zsh で変数を単語分割しない
- `for c in "db push" ...; do npx supabase $c --help` が、サブコマンドではなくルートのヘルプを表示した。zsh は未クォートの変数を単語分割しないため。関数の引数（`"$@"`）で渡す。

## 4. 「効かなかったこと」リスト
- typescript 7.0（latest）：typescript-eslint の peer が `<6.1.0` のため `~6.0.3` に固定した。
- Service Worker の active を待つだけでは、オフライン試験の前提（ページが制御下）が満たされない（上記）。

## 5. 今後の課題
- 期限通知・購入候補リスト・最低在庫量（BRIEF の将来拡張）。
- 変更履歴の画面表示（監査イベントは記録済み）。
- 本番ビルドの JS が約 520KB（supabase-js・zod・React）。オフライン用のプリキャッシュとしては許容範囲だが、必要なら分割する。
