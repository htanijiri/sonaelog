// スクリプト用の設定読み込み。秘密の値は表示しない。
import { config } from 'dotenv'

export function loadAdminEnv(): { url: string; secretKey: string } {
  config({ quiet: true })
  const url = process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing = [!url && 'VITE_SUPABASE_URL', !secretKey && 'SUPABASE_SECRET_KEY'].filter(Boolean)
  if (missing.length) {
    console.error(`.env に ${missing.join(' と ')} がありません（.env.example を参照）`)
    process.exit(2)
  }
  return { url: url!, secretKey: secretKey! }
}
