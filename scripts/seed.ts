// 初期データの検証と投入。
//   npm run seed:validate -- data/initial-data.json
//   npm run seed:apply -- data/initial-data.json --household-name "わが家"
// 投入は初回だけ INSERT する（seed_household）。2回実行しても二重登録せず、アプリで直した内容も上書きしない。
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { seedPayload, validateSeed } from '../src/domain/seed'
import { loadAdminEnv } from './lib/env'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'household-name': { type: 'string', default: 'わが家' },
    'seed-key': { type: 'string', default: 'initial' },
  },
})
const [command, file] = positionals
if (!command || !file || !['validate', 'apply'].includes(command)) {
  console.error('使い方：tsx scripts/seed.ts <validate|apply> <初期データの JSON> [--household-name 名前]')
  process.exit(2)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
const result = validateSeed(raw)
if (!result.ok || !result.data) {
  console.error(`検証に失敗しました（${result.errors.length} 件）：`)
  for (const e of result.errors) console.error(`  - ${e}`)
  process.exit(1)
}
const data = result.data
console.log(`検証 OK：保管場所 ${data.locations.length} / 明細 ${data.stock_lots.length}（snapshot_date ${data.metadata.snapshot_date}）`)
if (command === 'validate') process.exit(0)

const env = loadAdminEnv()
const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: res, error } = await admin.rpc('seed_household', {
  p_seed_key: values['seed-key'],
  p_name: values['household-name'],
  p_payload: seedPayload(data),
})
if (error) {
  console.error(`投入に失敗しました：${error.message}`)
  process.exit(1)
}
const r = res as Record<string, number | string>
console.log(
  `投入しました：保管場所 追加 ${r.locations_inserted}・既存のためスキップ ${r.locations_skipped} / 明細 追加 ${r.lots_inserted}・既存のためスキップ ${r.lots_skipped}`,
)
