// 本番のデプロイ。ビルド → 成果物の検査 → wrangler deploy。
// Worker の vars（Supabase の URL と公開キー）は .env から渡す（公開してよい値だが、リポジトリには書かない）。
//   npm run deploy
import { execFileSync } from 'node:child_process'
import { config } from 'dotenv'

config({ quiet: true })
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('.env に VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を設定してください')
  process.exit(2)
}
if (key.startsWith('sb_secret_')) {
  console.error('VITE_SUPABASE_PUBLISHABLE_KEY に secret key が入っています。公開キー（sb_publishable_）を使ってください')
  process.exit(2)
}
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' })
run('npm', ['run', 'build'])
run('npm', ['run', 'check:bundle'])
run('npx', ['wrangler', 'deploy', '--var', `SUPABASE_URL:${url}`, '--var', `SUPABASE_PUBLISHABLE_KEY:${key}`])
