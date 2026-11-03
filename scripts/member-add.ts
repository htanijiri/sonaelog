// 家族のアカウントを追加し、家庭に所属させる。パスワードは画面に表示されない入力で受け取る。
//   npm run member:add -- --email someone@example.com
//   npm run member:add -- --email someone@example.com --reset-password   （パスワードの再設定）
//   npm run member:add -- --list                                          （所属人数の確認。メールアドレスは表示しない）
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { loadAdminEnv } from './lib/env'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    household: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
  },
})

/** 入力を表示せずに1行読む（TTY の raw モード） */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      reject(new Error('パスワードはターミナルから入力してください'))
      return
    }
    process.stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (c === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1)
        else value += c
      }
    }
    stdin.on('data', onData)
  })
}

const env = loadAdminEnv()
const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function householdId(): Promise<string> {
  if (values.household) return values.household
  const { data, error } = await admin.from('households').select('id, name')
  if (error) throw new Error(error.message)
  if (!data || data.length !== 1) throw new Error(`家庭が ${data?.length ?? 0} 件あります。--household で ID を指定してください`)
  return data[0]!.id as string
}

if (values.list) {
  const hid = await householdId()
  const { count, error } = await admin.from('household_members').select('*', { count: 'exact', head: true }).eq('household_id', hid)
  if (error) throw new Error(error.message)
  console.log(`家庭 ${hid} のメンバー：${count} 人`)
  process.exit(0)
}

const email = values.email?.trim()
if (!email) {
  console.error('使い方：npm run member:add -- --email <メールアドレス> [--reset-password]')
  process.exit(2)
}

const password = await readHidden('パスワード（8文字以上。表示されません）：')
const again = await readHidden('もう一度入力してください：')
if (password !== again) {
  console.error('2回の入力が一致しません。もう一度やり直してください')
  process.exit(1)
}
if (password.length < 8) {
  console.error('パスワードは8文字以上にしてください')
  process.exit(1)
}

// 既存ユーザーを探す（人数が少ないので一覧から探す）
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listError) throw new Error(listError.message)
const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

let userId: string
if (existing) {
  if (!values['reset-password']) {
    console.error('このメールアドレスのアカウントはすでにあります。パスワードを変えるときは --reset-password を付けてください')
    process.exit(1)
  }
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password })
  if (error) throw new Error(error.message)
  userId = existing.id
  console.log('パスワードを再設定しました')
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  userId = data.user.id
  console.log('アカウントを作成しました')
}

const hid = await householdId()
const { error: memberError } = await admin
  .from('household_members')
  .upsert({ household_id: hid, user_id: userId }, { onConflict: 'household_id,user_id', ignoreDuplicates: true })
if (memberError) throw new Error(memberError.message)
console.log('家庭に所属させました。アプリにログインできます')
