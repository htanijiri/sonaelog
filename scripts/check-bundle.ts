// ビルド成果物（dist/）に、見本データ・実データ・秘密の鍵が入っていないかを確かめる。
// 使い方：npx tsx scripts/check-bundle.ts dist
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'

const dir = process.argv[2] ?? 'dist'
if (!existsSync(dir)) {
  console.error(`${dir} がありません。先に npm run build を実行してください`)
  process.exit(2)
}

function files(d: string): string[] {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

/** 品名のうち、画面の文言と偶然一致しにくい長さのものだけを使う */
function lotNames(path: string): string[] {
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8')) as { stock_lots: { name: string }[] }
  return [...new Set(data.stock_lots.map((l) => l.name))].filter((n) => n.length >= 6 && n !== 'カセットガス')
}

const env = config({ quiet: true }).parsed ?? {}
const needles: { label: string; value: string | RegExp }[] = [
  ...lotNames('fixtures/sample-data.json').map((v) => ({ label: '見本データの品名', value: v })),
  ...lotNames('data/initial-data.json').map((v) => ({ label: '実データの品名', value: v })),
  // 接頭辞だけ（supabase-js が鍵の種類を判定する文字列）は対象外。接頭辞のあとに鍵の本体が続くものを探す
  { label: 'secret key の形をした値', value: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { label: 'service_role', value: 'service_role' },
  { label: '疑似クラウドの API', value: '__demo_api' },
]
if (env.SUPABASE_SECRET_KEY) needles.push({ label: '.env の SUPABASE_SECRET_KEY', value: env.SUPABASE_SECRET_KEY })

const problems: string[] = []
for (const f of files(dir)) {
  const text = readFileSync(f, 'utf8')
  for (const n of needles) {
    // 秘密の値そのものは表示しない
    const hit = typeof n.value === 'string' ? text.includes(n.value) : n.value.test(text)
    if (hit) problems.push(`${f}: ${n.label}${n.label.includes('品名') ? `「${String(n.value)}」` : ''} が含まれています`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`OK：${dir} に見本データ・実データ・秘密の鍵は含まれていません（${needles.length} 項目を確認）`)
