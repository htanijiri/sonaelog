-- sonaelog の初期スキーマ。
-- 方針：
--   * 業務テーブルはすべて RLS。家庭への所属（household_members）を条件にし、anon には権限を与えない。
--   * 書き込みは apply_change()（security invoker）にまとめ、変更・監査イベント・revision 加算・楽観ロックを
--     1トランザクションで行う。画面側のロジック（src/domain/changes.ts）と同じ規則にする。
--   * 期限・製造年月は文字列（YYYY-MM-DD / YYYY-MM）と精度の組で持ち、DATE に変換して保存しない。

-- ============================================================
-- 権限の初期化：これから作るテーブル・関数を anon に公開しない
-- ============================================================
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 内部用の関数は private スキーマに置く（API として公開されるのは public だけなので、直接は呼べない）
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon;

-- ============================================================
-- 日付の検証
-- ============================================================
create function private.is_valid_date_value(v text, p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v is null and p is null then return true; end if;
  if v is null or p is null then return false; end if;
  if p = 'month' then
    return v ~ '^\d{4}-(0[1-9]|1[0-2])$';
  elsif p = 'day' then
    if v !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$' then return false; end if;
    begin
      -- 2027-02-30 のような実在しない日はキャストで例外になる
      return to_char(v::date, 'YYYY-MM-DD') = v;
    exception when others then
      return false;
    end;
  end if;
  return false;
end;
$$;

-- ============================================================
-- テーブル
-- ============================================================
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 初期データ投入で同じ家庭を二重に作らないためのキー
  seed_key text unique,
  -- 在庫・保管場所が変わるたびに増える（端末の保存分が古いかどうかの目安）
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  seed_code text,
  display_name text not null check (length(btrim(display_name)) > 0),
  kind text not null check (kind in ('long_term', 'go_bag', 'rolling', 'pending_consumption', 'other')),
  physical_note text,
  parent_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (household_id, seed_code),
  unique (id, household_id),
  foreign key (parent_id, household_id) references public.storage_locations (id, household_id)
);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  seed_code text,
  location_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  category text not null check (category in (
    'food', 'water', 'fuel', 'power', 'sanitation', 'medical', 'shelter',
    'safety', 'communication', 'tools', 'tableware', 'children', 'unknown'
  )),
  quantity numeric not null check (quantity >= 0),
  unit text not null check (length(btrim(unit)) > 0),
  expiry_value text,
  expiry_precision text check (expiry_precision in ('day', 'month')),
  expiry_kind text check (expiry_kind in ('best_before', 'use_or_inspection')),
  manufactured_value text,
  manufactured_precision text check (manufactured_precision in ('day', 'month')),
  shelf_life_months integer check (shelf_life_months > 0),
  expiry_check text not null check (expiry_check in (
    'exact_or_month_known', 'not_recorded',
    'reported_no_expiry_issue_exact_unknown', 'reported_within_one_year_exact_unknown'
  )),
  use_status text not null check (use_status in (
    'stored', 'removed_for_consumption', 'non_drinking_candidate',
    'replacement_planned', 'expired_trial', 'near_expiry_keep_pending'
  )),
  source text not null check (source in ('user', 'photo_review', 'user_confirmed')),
  needs_review boolean not null default false,
  notes text not null default '',
  liters_per_unit numeric check (liters_per_unit > 0),
  kcal_per_unit numeric check (kcal_per_unit > 0),
  -- 非常用トイレの公称使用回数（1単位あたり）。確認できたものだけ入れる
  uses_per_unit numeric check (uses_per_unit > 0),
  -- セット商品の内訳（参考）。独立した在庫として合算しない
  components jsonb check (components is null or jsonb_typeof(components) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archive_reason text,
  unique (household_id, seed_code),
  foreign key (location_id, household_id) references public.storage_locations (id, household_id),
  constraint expiry_valid check (private.is_valid_date_value(expiry_value, expiry_precision)),
  constraint manufactured_valid check (private.is_valid_date_value(manufactured_value, manufactured_precision)),
  -- 期限の日付があるときだけ「記録済み」
  constraint expiry_check_consistent check ((expiry_value is null) = (expiry_check <> 'exact_or_month_known')),
  -- 数量 0 の明細は通常の在庫に残さない（消費・廃棄でアーカイブする）
  constraint zero_only_archived check (quantity > 0 or archived_at is not null)
);
create index inventory_lots_household_idx on public.inventory_lots (household_id) where archived_at is null;

create table public.inventory_change_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  lot_id uuid references public.inventory_lots (id) on delete set null,
  location_id uuid references public.storage_locations (id) on delete set null,
  -- null はシステム（初期データ投入）
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  previous_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now()
);
create index inventory_change_events_household_idx on public.inventory_change_events (household_id, occurred_at desc);

-- ============================================================
-- revision の加算（利用者に households の UPDATE 権限を与えないため security definer）
-- ============================================================
create function private.bump_household_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.households set revision = revision + 1 where id = new.household_id;
  return new;
end;
$$;
revoke execute on function private.bump_household_revision() from public, anon, authenticated;

create trigger lots_bump_revision after insert or update on public.inventory_lots
  for each row execute function private.bump_household_revision();
create trigger locations_bump_revision after insert or update on public.storage_locations
  for each row execute function private.bump_household_revision();

-- ============================================================
-- RLS
-- ============================================================
create function private.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.storage_locations enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_change_events enable row level security;

create policy households_select on public.households
  for select to authenticated using (private.is_member(id));

create policy members_select on public.household_members
  for select to authenticated using (private.is_member(household_id));

create policy locations_select on public.storage_locations
  for select to authenticated using (private.is_member(household_id));
create policy locations_insert on public.storage_locations
  for insert to authenticated with check (private.is_member(household_id));
create policy locations_update on public.storage_locations
  for update to authenticated using (private.is_member(household_id)) with check (private.is_member(household_id));

create policy lots_select on public.inventory_lots
  for select to authenticated using (private.is_member(household_id));
create policy lots_insert on public.inventory_lots
  for insert to authenticated with check (private.is_member(household_id));
create policy lots_update on public.inventory_lots
  for update to authenticated using (private.is_member(household_id)) with check (private.is_member(household_id));

create policy events_select on public.inventory_change_events
  for select to authenticated using (private.is_member(household_id));
create policy events_insert on public.inventory_change_events
  for insert to authenticated
  with check (private.is_member(household_id) and actor_user_id = (select auth.uid()));

-- 権限：anon には何も与えない。authenticated は必要な操作だけ（DELETE はなし）
revoke all on public.households, public.household_members, public.storage_locations,
  public.inventory_lots, public.inventory_change_events from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
grant select, insert, update on public.storage_locations, public.inventory_lots to authenticated;
grant select, insert on public.inventory_change_events to authenticated;
grant all on public.households, public.household_members, public.storage_locations,
  public.inventory_lots, public.inventory_change_events to service_role;
