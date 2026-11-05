# sonaelog デプロイ手順書

手順はできるだけ Claude が実行する。ユーザーの作業は「（実施者：ユーザー。理由：…）」と書いたものだけ。

## 0. 全体像と前提
| 役割 | サービス | 備考 |
|---|---|---|
| アプリの配信 | Cloudflare Workers（静的アセット） | `https://sonaelog.tanijiri.dev`。`*.workers.dev` は無効 |
| 休止防止 | 同じ Worker の cron（3日に1回） | Supabase の `ping()` を呼ぶだけ |
| データベース・認証 | Supabase（無料プラン、東京 `ap-northeast-1`） | プロジェクト名 `sonaelog` |
| コード | GitHub 公開リポジトリ | 実データ・`.env`・`journal/`・`brief/` は含めない |

ローカルに必要なもの：Node.js 22 以上、`npm ci` 済み（`wrangler` と `supabase` CLI は devDependencies に入っている）。
- Cloudflare：`npx wrangler login` 済み（実施者：ユーザー。理由：ログインは本人しかできない）
- Supabase：`npx supabase login` 済み（実施者：ユーザー。理由：同上）

## 1. 設定値・シークレット
値そのものはここに書かない。

| 名前 | 用途 | 置き場所 |
|---|---|---|
| `VITE_SUPABASE_URL` | アプリ・スクリプトの接続先 | `.env`（ビルド時にアプリへ埋め込まれる。公開してよい値） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ブラウザ用の公開キー（`sb_publishable_…`） | `.env`（同上） |
| `SUPABASE_SECRET_KEY` | 初期データ投入・アカウント追加のスクリプト用（`sb_secret_…`） | `.env` のみ。**アプリに埋め込まない・Worker にも渡さない** |
| Worker の `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | 休止防止の ping | `npm run deploy` が `.env` から `--var` で渡す |
| データベースのパスワード | Supabase のプロジェクト作成・マイグレーション | どこにも保存しない（実施者：ユーザー。理由：秘密情報は本人が決めて入力する） |

`.env` の作り方：`.env.example` をコピーし、値は Claude が `npx supabase projects api-keys` から取得して書き込む（画面には出さない）。

## 2. 初回の構築

### 2-1. Supabase
```bash
npx supabase login
```
（実施者：ユーザー。ブラウザでログインする）

```bash
npx supabase orgs list
npx supabase projects list
```
無料プランは1つの組織で同時に動かせるプロジェクトが2つまで。**組織が自分のもの（仕事用などの別アカウントでない）ことをここで確かめる。**

```bash
npx supabase projects create sonaelog --org-id <組織ID> --region ap-northeast-1
```
データベースのパスワードを聞かれたら入力する（実施者：ユーザー）。パスワードはパスワード管理アプリなどに保存する。以降の `link`・`db push --remote` はアクセストークンで通るので、ふだんは入力しない。

```bash
npx supabase link --project-ref <プロジェクトの ref>
npx supabase db push --remote
npx supabase config push --yes
npx supabase db advisors --remote --type security
```

### 2-2. 初期データとアカウント
```bash
npm run seed:apply -- data/initial-data.json --household-name "わが家"
npm run member:add
```
`member:add` はメールアドレスとパスワード（非表示）を聞く。大人2人分、2回実行する（実施者：ユーザー。理由：パスワードは本人が決めて入力する）。

### 2-3. アプリの公開
デプロイの前に、Cloudflare の CLI が tanijiri.dev を持つアカウントでログインしていることを確かめる（別アカウントのままだと、そのアカウントに Worker ができてしまい、独自ドメインの設定で失敗する）。
```bash
npx wrangler whoami
npm run deploy
```
`npm run build` → `check:bundle`（見本データ・実データ・秘密の鍵が入っていないか）→ `wrangler deploy`。
`wrangler.jsonc` の `routes`（`custom_domain: true`）で、`sonaelog.tanijiri.dev` の DNS レコードと証明書が自動で作られる。

## 3. デプロイ後の動作確認
Claude がコマンドで確認する項目：
- [ ] `https://sonaelog.tanijiri.dev` が HTTPS で開き、manifest と `sw.js` が返る（画面遷移の確認は `-H 'Sec-Fetch-Mode: navigate' -H 'Accept: text/html'` を付ける）
- [ ] `*.workers.dev` が 404
- [ ] 公開キーだけで業務テーブルを読むと拒否される（`curl …/rest/v1/inventory_lots`）
- [ ] 新規登録（`/auth/v1/signup`）が拒否される
- [ ] `ping` RPC が `true` を返す
- [ ] 2回目の `seed:apply` で「追加 0・スキップ 129」
- [ ] `npm run member:add -- --list` でメンバーが2人

ユーザーにお願いする項目（実機の Android が必要なため）：仕様書 009 の「完成後に手で確認するもの」。

## 4. 運用メモ
- **更新**：コードを変えたら `npm run deploy`。アプリは Service Worker が自動で新しい版に入れ替える。
- **DB の変更**：`supabase/migrations/` に新しい SQL を足し、`npx supabase db push --remote`。端末内の保存形式を変える場合は `src/local/snapshotStore.ts` の `LOCAL_FORMAT` を上げて移行を書く。
- **アカウントの追加**：`npm run member:add`。**パスワードの再設定**：`npm run member:add -- --email <メール> --reset-password`。
- **休止防止のログ**：`npx wrangler tail sonaelog`（cron の実行時に「ping に成功しました」が出る）。
- **Supabase が休止してしまった場合**：アプリは「同期失敗」と表示し、端末の保存分で閲覧は続けられる。Supabase の管理画面からプロジェクトを再開する（実施者：ユーザー。理由：ログインが必要）。

## 5. ロールバック
```bash
npx wrangler deployments list
npx wrangler rollback <バージョン ID> --message "戻す理由" -y
```
- `deployments list` の `Version(s)` に出る ID を指定する。戻した版の Worker の変数（`SUPABASE_URL` など）も一緒に戻る。
- 2026-11-05 に、同じ内容で再デプロイしてから前の版へ戻し、公開アドレスが 200 を返すことを確かめた。
- アプリの端末側は、Service Worker が戻した版を新しい版として取り込む（開き直すと切り替わる）。
- 休止防止の cron は版に含まれないので、ロールバックしても変わらない。
- 休止防止を手元で試す：`npx wrangler dev --test-scheduled --var SUPABASE_URL:… --var SUPABASE_PUBLISHABLE_KEY:…` を起動し、`curl "http://localhost:8787/__scheduled?cron=0+3+*/3+*+*"`。
DB のマイグレーションは自動では戻らない。戻す SQL を新しいマイグレーションとして書いて `db push` する。
