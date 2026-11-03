// PGlite（WASM の PostgreSQL）に Supabase の最低限の環境を再現し、本物と同じマイグレーションを流す。
// 本番の Supabase にテストデータを入れずに、RLS・制約・関数を検証するため。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'

const MIGRATIONS = 'supabase/migrations'

/** Supabase が用意しているロール・auth スキーマ・既定の権限のうち、テストに必要な部分だけを再現する */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase は public のテーブル・関数を既定で anon / authenticated に公開する。
-- マイグレーション側でこれを取り消していることを確かめるため、同じ既定値にしておく
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`

export async function createDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  }
  return db
}

export type Who = { role: 'anon' } | { role: 'authenticated'; userId: string } | { role: 'service_role' }

/** 指定したロール・ユーザーとして、1トランザクションで処理する（PostgREST の動きに合わせる） */
export async function as<T>(db: PGlite, who: Who, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who.role}`)
    const claims = who.role === 'authenticated' ? JSON.stringify({ sub: who.userId, role: 'authenticated' }) : ''
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    return fn(tx)
  })
}

export const user = (userId: string): Who => ({ role: 'authenticated', userId })
export const ANON: Who = { role: 'anon' }
export const SERVICE: Who = { role: 'service_role' }

/** RPC を呼ぶ（PostgREST の rpc と同じく、関数を select する） */
export async function rpc<T = unknown>(db: PGlite, who: Who, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const names = Object.keys(args)
  const params = names.map((n, i) => `${n} => $${i + 1}`).join(', ')
  const values = names.map((n) => {
    const v = args[n]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })
  return as(db, who, async (tx) => {
    const res = await tx.query<{ r: T }>(`select public.${fn}(${params}) as r`, values)
    return res.rows[0]!.r
  })
}

/** 2つの家庭とメンバー、保管場所を用意する */
export async function setupHouseholds(db: PGlite) {
  const ids = {
    userA: '11111111-1111-4111-8111-111111111111',
    userA2: '11111111-1111-4111-8111-222222222222',
    userB: '22222222-2222-4222-8222-222222222222',
    outsider: '33333333-3333-4333-8333-333333333333',
    homeA: 'aaaaaaaa-0000-4000-8000-000000000001',
    homeB: 'bbbbbbbb-0000-4000-8000-000000000001',
    locA1: 'aaaaaaaa-0000-4000-8000-0000000000a1',
    locA2: 'aaaaaaaa-0000-4000-8000-0000000000a2',
    locB1: 'bbbbbbbb-0000-4000-8000-0000000000b1',
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ids.userA}', 'a@example.test'), ('${ids.userA2}', 'a2@example.test'),
      ('${ids.userB}', 'b@example.test'), ('${ids.outsider}', 'x@example.test');
    insert into public.households (id, name) values ('${ids.homeA}', '家庭A'), ('${ids.homeB}', '家庭B');
    insert into public.household_members (household_id, user_id) values
      ('${ids.homeA}', '${ids.userA}'), ('${ids.homeA}', '${ids.userA2}'), ('${ids.homeB}', '${ids.userB}');
    insert into public.storage_locations (id, household_id, display_name, kind, sort_order) values
      ('${ids.locA1}', '${ids.homeA}', '箱A1', 'long_term', 0),
      ('${ids.locA2}', '${ids.homeA}', 'リュックA2', 'go_bag', 1),
      ('${ids.locB1}', '${ids.homeB}', '箱B1', 'long_term', 0);
  `)
  return ids
}

/** 明細の入力（LotInput）の雛形 */
export function lotInput(locationId: string, patch: Record<string, unknown> = {}) {
  return {
    location_id: locationId,
    name: 'テスト用の水',
    category: 'water',
    quantity: 6,
    unit: '本',
    expiry_value: '2027-03',
    expiry_precision: 'month',
    expiry_kind: null,
    manufactured_value: null,
    manufactured_precision: null,
    shelf_life_months: null,
    expiry_check: 'exact_or_month_known',
    use_status: 'stored',
    source: 'user',
    needs_review: false,
    notes: '',
    liters_per_unit: 2,
    kcal_per_unit: null,
    uses_per_unit: null,
    components: null,
    ...patch,
  }
}
