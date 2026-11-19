-- 食料品の味の感想（spec 010）。
-- 方針：
--   * 感想は明細ではなく「品名」ごとに1つ（家庭で共有）。明細を食べ切ってアーカイブしても感想は残る。
--   * 品名の照合は正規化キー（NFKC・前後の空白除去・連続する空白を1つ）で行う。src/domain/foodReviews.ts の foodNameKey と同じ規則。
--   * 書き込みは apply_change（security invoker）の set_food_review だけ。既存の apply_change は private._apply_change_core に移し、
--     新しい apply_change が set_food_review を処理して、それ以外はそのまま委ねる（既存の処理を書き写さないため）。

-- ============================================================
-- 品名の正規化キー
-- ============================================================
create function private.food_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(normalize(coalesce(p_name, ''), NFKC)), '\s+', ' ', 'g');
$$;

-- ============================================================
-- テーブル
-- ============================================================
create table public.food_reviews (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null check (length(name_key) > 0),
  -- 画面に出す品名（最後に書いたときの品名）
  display_name text not null check (length(btrim(display_name)) > 0),
  rating text check (rating in ('again', 'ok', 'never')),
  comment text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (household_id, name_key),
  constraint review_not_empty check (rating is not null or comment <> '')
);

-- revision の加算（削除のときも数える）
create function private.bump_household_revision_any()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.households set revision = revision + 1
    where id = case when tg_op = 'DELETE' then old.household_id else new.household_id end;
  return null;
end;
$$;
revoke execute on function private.bump_household_revision_any() from public, anon, authenticated;

create trigger food_reviews_bump_revision after insert or update or delete on public.food_reviews
  for each row execute function private.bump_household_revision_any();

-- ============================================================
-- RLS と権限（anon には何も与えない）
-- ============================================================
alter table public.food_reviews enable row level security;

create policy food_reviews_select on public.food_reviews
  for select to authenticated using (private.is_member(household_id));
create policy food_reviews_insert on public.food_reviews
  for insert to authenticated with check (private.is_member(household_id));
create policy food_reviews_update on public.food_reviews
  for update to authenticated using (private.is_member(household_id)) with check (private.is_member(household_id));
create policy food_reviews_delete on public.food_reviews
  for delete to authenticated using (private.is_member(household_id));

revoke all on public.food_reviews from anon, authenticated;
grant select, insert, update, delete on public.food_reviews to authenticated;
grant all on public.food_reviews to service_role;

-- ============================================================
-- 読み取り：スナップショットに food_reviews を足す（version は 1 のまま。古いアプリは知らない項目を無視する）
-- ============================================================
create or replace function public.get_household_snapshot(p_household_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  hid uuid := private.current_household_id(p_household_id);
  result jsonb;
begin
  select jsonb_build_object(
    'format', 'sonaelog-snapshot',
    'version', 1,
    'household_id', h.id,
    'household_name', h.name,
    'revision', h.revision,
    'captured_at', now(),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(s) - 'household_id' - 'archived_at' - 'created_at' order by s.sort_order, s.created_at)
      from public.storage_locations s
      where s.household_id = h.id and s.archived_at is null
    ), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(to_jsonb(l) - 'household_id' - 'archived_at' - 'archive_reason' order by l.created_at, l.seed_code)
      from public.inventory_lots l
      where l.household_id = h.id and l.archived_at is null
    ), '[]'::jsonb),
    'food_reviews', coalesce((
      select jsonb_agg(to_jsonb(f) - 'household_id' order by f.name_key)
      from public.food_reviews f
      where f.household_id = h.id
    ), '[]'::jsonb)
  ) into result
  from public.households h
  where h.id = hid;
  return result;
end;
$$;

-- ============================================================
-- 書き込み：既存の apply_change を内部用に移し、前段に set_food_review を足す
-- ============================================================
alter function public.apply_change(jsonb) set schema private;
alter function private.apply_change(jsonb) rename to _apply_change_core;
revoke execute on function private._apply_change_core(jsonb) from public, anon;
grant execute on function private._apply_change_core(jsonb) to authenticated;

create function private._set_food_review(hid uuid, p_change jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  name_ text := btrim(normalize(coalesce(p_change ->> 'name', ''), NFKC));
  key_ text := private.food_name_key(p_change ->> 'name');
  rating_ text := nullif(p_change ->> 'rating', '');
  comment_ text := btrim(coalesce(p_change ->> 'comment', ''));
  expected_ text := nullif(p_change ->> 'expected_updated_at', '');
  cur public.food_reviews;
  has_cur boolean;
begin
  if key_ = '' then
    raise exception '品名を入れてください' using errcode = 'SL400';
  end if;
  if rating_ is not null and rating_ not in ('again', 'ok', 'never') then
    raise exception '評価は「また買う」「ふつう」「もう買わない」から選んでください' using errcode = 'SL400';
  end if;
  if char_length(comment_) > 500 then
    raise exception 'コメントは500文字までにしてください' using errcode = 'SL400';
  end if;

  select * into cur from public.food_reviews where household_id = hid and name_key = key_ for update;
  has_cur := found;

  -- 楽観ロック：null は「まだない」前提
  if (expected_ is null and has_cur) or (expected_ is not null and (not has_cur or cur.updated_at <> expected_::timestamptz)) then
    raise exception 'ほかの家族が先に感想を変更しました。最新を読み込んでからやり直してください' using errcode = 'SL409';
  end if;

  -- 書けるのは、食料品の有効な明細がある品名か、すでに感想がある品名だけ
  if not has_cur and not exists (
    select 1 from public.inventory_lots l
    where l.household_id = hid and l.archived_at is null and l.category = 'food'
      and private.food_name_key(l.name) = key_
  ) then
    raise exception '食料品の在庫にない品名には感想を書けません' using errcode = 'SL400';
  end if;

  if rating_ is null and comment_ = '' then
    if has_cur then
      delete from public.food_reviews where id = cur.id;
      perform private._record(hid, null, null, 'food_review_delete',
        jsonb_build_object('name', cur.display_name, 'rating', cur.rating, 'comment', cur.comment), null);
    end if;
    return;
  end if;

  if has_cur then
    update public.food_reviews set
      display_name = name_, rating = rating_, comment = comment_, updated_at = now(), updated_by = (select auth.uid())
    where id = cur.id;
    perform private._record(hid, null, null, 'food_review_update',
      jsonb_build_object('name', cur.display_name, 'rating', cur.rating, 'comment', cur.comment),
      jsonb_build_object('name', name_, 'rating', rating_, 'comment', comment_));
  else
    insert into public.food_reviews (household_id, name_key, display_name, rating, comment, updated_by)
      values (hid, key_, name_, rating_, comment_, (select auth.uid()));
    perform private._record(hid, null, null, 'food_review_create', null,
      jsonb_build_object('name', name_, 'rating', rating_, 'comment', comment_));
  end if;
end;
$$;

create function public.apply_change(p_change jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hid uuid;
begin
  if p_change ->> 'type' = 'set_food_review' then
    hid := private.current_household_id(nullif(p_change ->> 'household_id', '')::uuid);
    perform private._set_food_review(hid, p_change);
    return jsonb_build_object('ok', true, 'revision', (select revision from public.households where id = hid));
  end if;
  return private._apply_change_core(p_change);
end;
$$;

-- ============================================================
-- 実行権限
-- ============================================================
revoke execute on function public.apply_change(jsonb) from public, anon;
grant execute on function public.apply_change(jsonb) to authenticated;
revoke execute on function private.food_name_key(text) from public, anon;
grant execute on function private.food_name_key(text) to authenticated;
revoke execute on function private._set_food_review(uuid, jsonb) from public, anon;
grant execute on function private._set_food_review(uuid, jsonb) to authenticated;
