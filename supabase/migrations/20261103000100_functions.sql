-- 読み取り（get_household_snapshot）・書き込み（apply_change）・初期投入（seed_household）・休止防止（ping）。
-- apply_change は security invoker なので RLS がそのまま効く。エラーは独自の SQLSTATE で返す：
--   SL400 入力の誤り / SL403 権限・ログイン / SL404 見つからない / SL409 ほかの人が先に変更した

-- ============================================================
-- 共通
-- ============================================================

-- ログイン中のユーザーが属する家庭。複数に属する場合は p_household_id で選ぶ（将来の複数家庭に備える）
create function private.current_household_id(p_household_id uuid default null)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  hid uuid;
  n integer;
begin
  if (select auth.uid()) is null then
    raise exception 'ログインが必要です' using errcode = 'SL403';
  end if;
  if p_household_id is not null then
    if not private.is_member(p_household_id) then
      raise exception 'この家庭のメンバーではありません' using errcode = 'SL403';
    end if;
    return p_household_id;
  end if;
  select count(*), min(household_id::text)::uuid into n, hid
    from public.household_members where user_id = (select auth.uid());
  if n = 0 then
    raise exception '家庭に所属していません' using errcode = 'SL403';
  elsif n > 1 then
    raise exception '複数の家庭に所属しています。家庭を指定してください' using errcode = 'SL400';
  end if;
  return hid;
end;
$$;

-- ============================================================
-- 読み取り：家庭の完全なスナップショット（1文で組み立てるので一貫している）
-- ============================================================
create function public.get_household_snapshot(p_household_id uuid default null)
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
    ), '[]'::jsonb)
  ) into result
  from public.households h
  where h.id = hid;
  return result;
end;
$$;

-- ============================================================
-- 書き込みの部品
-- ============================================================

-- 有効な明細を行ロックして取り出し、楽観ロックを確かめる
create function private._lock_lot(hid uuid, p_lot_id text, p_expected text)
returns public.inventory_lots
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.inventory_lots;
begin
  select * into r from public.inventory_lots
    where id = p_lot_id::uuid and household_id = hid and archived_at is null
    for update;
  if not found then
    raise exception '明細が見つかりません（ほかの家族が削除した可能性があります）' using errcode = 'SL404';
  end if;
  if p_expected is null or r.updated_at <> p_expected::timestamptz then
    raise exception 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください' using errcode = 'SL409';
  end if;
  return r;
end;
$$;

create function private._assert_location(hid uuid, p_location_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_location_id is null or not exists (
    select 1 from public.storage_locations
    where id = p_location_id and household_id = hid and archived_at is null
  ) then
    raise exception '保管場所が見つかりません' using errcode = 'SL400';
  end if;
end;
$$;

-- 入力（jsonb）から新しい明細を作る。id・日時・seed_code はここで決める
create function private._insert_lot(hid uuid, j jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.inventory_lots;
begin
  r := jsonb_populate_record(null::public.inventory_lots, j);
  r.id := gen_random_uuid();
  r.household_id := hid;
  r.seed_code := null;
  r.created_at := now();
  r.updated_at := now();
  r.archived_at := null;
  r.archive_reason := null;
  r.needs_review := coalesce(r.needs_review, false);
  r.notes := coalesce(r.notes, '');
  perform private._assert_location(hid, r.location_id);
  if r.quantity is null or r.quantity <= 0 then
    raise exception '数量は 0 より大きくしてください' using errcode = 'SL400';
  end if;
  insert into public.inventory_lots values (r.*);
  return r.id;
end;
$$;

-- 数量を減らす。0 になったらアーカイブ
create function private._reduce_lot(r public.inventory_lots, p_amount numeric, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '減らす数は 0 より大きくしてください' using errcode = 'SL400';
  end if;
  if p_amount > r.quantity then
    raise exception '残りの数量（%）より多くは減らせません', r.quantity using errcode = 'SL400';
  end if;
  update public.inventory_lots set
    quantity = r.quantity - p_amount,
    updated_at = now(),
    archived_at = case when r.quantity - p_amount = 0 then now() end,
    archive_reason = case when r.quantity - p_amount = 0 then p_reason end
  where id = r.id;
end;
$$;

create function private._record(hid uuid, p_lot uuid, p_location uuid, p_type text, p_prev jsonb, p_new jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.inventory_change_events (household_id, lot_id, location_id, actor_user_id, event_type, previous_value, new_value)
  values (hid, p_lot, p_location, (select auth.uid()), p_type, p_prev, p_new);
$$;

-- 明細の利用者が編集できる項目（id・家庭・日時などを除く）
create function private._lot_input(r public.inventory_lots)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select to_jsonb(r) - 'id' - 'household_id' - 'seed_code' - 'created_at' - 'updated_at' - 'archived_at' - 'archive_reason';
$$;

-- ============================================================
-- 書き込み：変更を1つ適用する（src/domain/changes.ts の applyChangeToState と同じ規則）
-- ============================================================
create function public.apply_change(p_change jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hid uuid := private.current_household_id(nullif(p_change ->> 'household_id', '')::uuid);
  t text := p_change ->> 'type';
  r public.inventory_lots;
  n public.inventory_lots;
  loc public.storage_locations;
  new_id uuid;
  amount numeric;
  merged jsonb;
  child jsonb;
  children uuid[] := '{}';
  name_ text;
  note_ text;
begin
  case t
  when 'create_lot' then
    new_id := private._insert_lot(hid, p_change -> 'lot');
    perform private._record(hid, new_id, null, 'create', null, p_change -> 'lot');

  when 'update_lot' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    merged := private._lot_input(r) || coalesce(p_change -> 'patch', '{}'::jsonb);
    n := jsonb_populate_record(r, merged);
    if n.location_id <> r.location_id then perform private._assert_location(hid, n.location_id); end if;
    if n.quantity is null or n.quantity <= 0 then
      raise exception '数量を 0 にするときは「消費・廃棄」を使ってください' using errcode = 'SL400';
    end if;
    update public.inventory_lots set
      location_id = n.location_id, name = n.name, category = n.category, quantity = n.quantity, unit = n.unit,
      expiry_value = n.expiry_value, expiry_precision = n.expiry_precision, expiry_kind = n.expiry_kind,
      manufactured_value = n.manufactured_value, manufactured_precision = n.manufactured_precision,
      shelf_life_months = n.shelf_life_months, expiry_check = n.expiry_check, use_status = n.use_status,
      source = n.source, needs_review = coalesce(n.needs_review, false), notes = coalesce(n.notes, ''),
      liters_per_unit = n.liters_per_unit, kcal_per_unit = n.kcal_per_unit, uses_per_unit = n.uses_per_unit,
      components = n.components, updated_at = now()
    where id = r.id;
    perform private._record(hid, r.id, null, 'update', private._lot_input(r), private._lot_input(n));

  when 'set_quantity' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    amount := (p_change ->> 'quantity')::numeric;
    if amount is null or amount < 0 then
      raise exception '数量は 0 以上にしてください' using errcode = 'SL400';
    end if;
    update public.inventory_lots set
      quantity = amount,
      updated_at = now(),
      archived_at = case when amount = 0 then now() end,
      archive_reason = case when amount = 0 then 'quantity_zero' end
    where id = r.id;
    perform private._record(hid, r.id, null, 'set_quantity', jsonb_build_object('quantity', r.quantity), jsonb_build_object('quantity', amount));

  when 'move_lot' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    perform private._assert_location(hid, (p_change ->> 'to_location_id')::uuid);
    if (p_change ->> 'to_location_id')::uuid = r.location_id then
      raise exception '同じ保管場所には移せません' using errcode = 'SL400';
    end if;
    amount := coalesce((p_change ->> 'quantity')::numeric, r.quantity);
    if amount <= 0 or amount > r.quantity then
      raise exception '移す数は 0 より大きく、残りの数量（%）以下にしてください', r.quantity using errcode = 'SL400';
    end if;
    if amount = r.quantity then
      update public.inventory_lots set location_id = (p_change ->> 'to_location_id')::uuid, updated_at = now() where id = r.id;
      perform private._record(hid, r.id, null, 'move', jsonb_build_object('location_id', r.location_id), jsonb_build_object('location_id', p_change ->> 'to_location_id'));
    else
      new_id := private._insert_lot(hid, private._lot_input(r) || jsonb_build_object('location_id', p_change ->> 'to_location_id', 'quantity', amount));
      update public.inventory_lots set quantity = r.quantity - amount, updated_at = now() where id = r.id;
      perform private._record(hid, r.id, null, 'move_partial', jsonb_build_object('quantity', r.quantity),
        jsonb_build_object('new_lot_id', new_id, 'quantity', amount, 'location_id', p_change ->> 'to_location_id'));
    end if;

  when 'consume' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    if coalesce(p_change ->> 'disposition', '') not in ('consumed', 'discarded') then
      raise exception '消費か廃棄かを選んでください' using errcode = 'SL400';
    end if;
    amount := (p_change ->> 'quantity')::numeric;
    perform private._reduce_lot(r, amount, p_change ->> 'disposition');
    perform private._record(hid, r.id, null, p_change ->> 'disposition', jsonb_build_object('quantity', r.quantity), jsonb_build_object('quantity', r.quantity - amount));

  when 'replace_lot' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    if coalesce(p_change ->> 'disposition', '') not in ('consumed', 'discarded') then
      raise exception '古い明細の扱い（消費か廃棄か）を選んでください' using errcode = 'SL400';
    end if;
    new_id := private._insert_lot(hid, p_change -> 'new_lot');
    update public.inventory_lots set archived_at = now(), archive_reason = p_change ->> 'disposition', updated_at = now() where id = r.id;
    perform private._record(hid, r.id, null, 'replace', jsonb_build_object('quantity', r.quantity, 'disposition', p_change ->> 'disposition'), jsonb_build_object('new_lot_id', new_id));

  when 'split_lot' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    if jsonb_array_length(coalesce(p_change -> 'children', '[]'::jsonb)) = 0 then
      raise exception '分けた先の明細を1つ以上入れてください' using errcode = 'SL400';
    end if;
    for child in select * from jsonb_array_elements(p_change -> 'children') loop
      children := children || private._insert_lot(hid, child);
    end loop;
    amount := (p_change ->> 'decrease')::numeric;
    perform private._reduce_lot(r, amount, 'split');
    perform private._record(hid, r.id, null, 'split', jsonb_build_object('quantity', r.quantity), jsonb_build_object('decrease', amount, 'children', to_jsonb(children)));

  when 'confirm_review' then
    r := private._lock_lot(hid, p_change ->> 'lot_id', p_change ->> 'expected_updated_at');
    note_ := nullif(btrim(coalesce(p_change ->> 'note', '')), '');
    update public.inventory_lots set
      needs_review = false,
      source = case when r.source = 'photo_review' then 'user_confirmed' else r.source end,
      notes = case when note_ is null then r.notes when r.notes = '' then note_ else r.notes || E'\n' || note_ end,
      updated_at = now()
    where id = r.id;
    perform private._record(hid, r.id, null, 'confirm_review', jsonb_build_object('needs_review', r.needs_review, 'source', r.source),
      jsonb_build_object('needs_review', false, 'source', case when r.source = 'photo_review' then 'user_confirmed' else r.source end));

  when 'upsert_location' then
    name_ := btrim(coalesce(p_change ->> 'display_name', ''));
    if name_ = '' then
      raise exception '保管場所の名前を入れてください' using errcode = 'SL400';
    end if;
    note_ := nullif(btrim(coalesce(p_change ->> 'physical_note', '')), '');
    if nullif(p_change ->> 'location_id', '') is not null then
      select * into loc from public.storage_locations
        where id = (p_change ->> 'location_id')::uuid and household_id = hid and archived_at is null for update;
      if not found then raise exception '保管場所が見つかりません' using errcode = 'SL404'; end if;
      if loc.updated_at <> (p_change ->> 'expected_updated_at')::timestamptz then
        raise exception 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください' using errcode = 'SL409';
      end if;
      update public.storage_locations set display_name = name_, kind = p_change ->> 'kind', physical_note = note_, updated_at = now()
        where id = loc.id;
      perform private._record(hid, null, loc.id, 'location_update',
        jsonb_build_object('display_name', loc.display_name, 'kind', loc.kind, 'physical_note', loc.physical_note),
        jsonb_build_object('display_name', name_, 'kind', p_change ->> 'kind', 'physical_note', note_));
    else
      insert into public.storage_locations (household_id, display_name, kind, physical_note, sort_order)
        values (hid, name_, p_change ->> 'kind', note_,
          coalesce((select max(sort_order) + 1 from public.storage_locations where household_id = hid), 0))
        returning id into new_id;
      perform private._record(hid, null, new_id, 'location_create', null,
        jsonb_build_object('display_name', name_, 'kind', p_change ->> 'kind', 'physical_note', note_));
    end if;

  when 'archive_location' then
    select * into loc from public.storage_locations
      where id = (p_change ->> 'location_id')::uuid and household_id = hid and archived_at is null for update;
    if not found then raise exception '保管場所が見つかりません' using errcode = 'SL404'; end if;
    if loc.updated_at <> (p_change ->> 'expected_updated_at')::timestamptz then
      raise exception 'ほかの家族が先に変更しました。最新を読み込んでからやり直してください' using errcode = 'SL409';
    end if;
    if exists (select 1 from public.inventory_lots where location_id = loc.id and archived_at is null) then
      raise exception '中身がある保管場所は削除できません。先に中身を移してください' using errcode = 'SL400';
    end if;
    update public.storage_locations set archived_at = now(), updated_at = now() where id = loc.id;
    perform private._record(hid, null, loc.id, 'location_archive', null, null);

  else
    raise exception '未知の操作です：%', t using errcode = 'SL400';
  end case;

  return jsonb_build_object('ok', true, 'revision', (select revision from public.households where id = hid));
end;
$$;

-- ============================================================
-- 初期データの投入（service_role だけ）。初回だけ INSERT し、既存の行は一切更新しない
-- ============================================================
create function public.seed_household(p_seed_key text, p_name text, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hid uuid;
  loc jsonb;
  lot jsonb;
  loc_id uuid;
  inserted_id uuid;
  locs_inserted integer := 0;
  locs_skipped integer := 0;
  lots_inserted integer := 0;
  lots_skipped integer := 0;
begin
  insert into public.households (name, seed_key) values (p_name, p_seed_key)
    on conflict (seed_key) do nothing;
  select id into hid from public.households where seed_key = p_seed_key;

  for loc in select * from jsonb_array_elements(p_payload -> 'locations') loop
    insert into public.storage_locations (household_id, seed_code, display_name, kind, physical_note, sort_order)
      values (hid, loc ->> 'seed_code', loc ->> 'display_name', loc ->> 'kind', loc ->> 'physical_note', (loc ->> 'sort_order')::integer)
      on conflict (household_id, seed_code) do nothing
      returning id into inserted_id;
    if inserted_id is null then locs_skipped := locs_skipped + 1; else locs_inserted := locs_inserted + 1; end if;
    inserted_id := null;
  end loop;
  -- 親子関係（今回の投入で新しく入った場所だけ）
  update public.storage_locations c set parent_id = p.id
    from jsonb_array_elements(p_payload -> 'locations') e
    join public.storage_locations p on p.household_id = hid and p.seed_code = e ->> 'parent_seed_code'
    where c.household_id = hid and c.seed_code = e ->> 'seed_code' and c.parent_id is null
      and e ->> 'parent_seed_code' is not null;

  for lot in select * from jsonb_array_elements(p_payload -> 'lots') loop
    select id into loc_id from public.storage_locations where household_id = hid and seed_code = lot ->> 'location_seed_code';
    if loc_id is null then
      raise exception '明細 % の保管場所 % が見つかりません', lot ->> 'seed_code', lot ->> 'location_seed_code' using errcode = 'SL400';
    end if;
    insert into public.inventory_lots (
      household_id, seed_code, location_id, name, category, quantity, unit,
      expiry_value, expiry_precision, expiry_kind, manufactured_value, manufactured_precision, shelf_life_months,
      expiry_check, use_status, source, needs_review, notes, liters_per_unit, kcal_per_unit, uses_per_unit, components
    ) values (
      hid, lot ->> 'seed_code', loc_id, lot ->> 'name', lot ->> 'category', (lot ->> 'quantity')::numeric, lot ->> 'unit',
      lot ->> 'expiry_value', lot ->> 'expiry_precision', lot ->> 'expiry_kind',
      lot ->> 'manufactured_value', lot ->> 'manufactured_precision', (lot ->> 'shelf_life_months')::integer,
      lot ->> 'expiry_check', lot ->> 'use_status', lot ->> 'source', coalesce((lot ->> 'needs_review')::boolean, false),
      coalesce(lot ->> 'notes', ''), (lot ->> 'liters_per_unit')::numeric, (lot ->> 'kcal_per_unit')::numeric,
      (lot ->> 'uses_per_unit')::numeric, nullif(lot -> 'components', 'null'::jsonb)
    )
    on conflict (household_id, seed_code) do nothing
    returning id into inserted_id;
    if inserted_id is null then
      lots_skipped := lots_skipped + 1;
    else
      lots_inserted := lots_inserted + 1;
      insert into public.inventory_change_events (household_id, lot_id, actor_user_id, event_type, new_value)
        values (hid, inserted_id, null, 'seed', jsonb_build_object('seed_code', lot ->> 'seed_code'));
    end if;
    inserted_id := null;
    loc_id := null;
  end loop;

  return jsonb_build_object(
    'household_id', hid,
    'locations_inserted', locs_inserted, 'locations_skipped', locs_skipped,
    'lots_inserted', lots_inserted, 'lots_skipped', lots_skipped
  );
end;
$$;

-- ============================================================
-- 休止防止の軽いアクセス（業務データに触れない）
-- ============================================================
create function public.ping()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

-- ============================================================
-- 実行権限
-- ============================================================
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.current_household_id(uuid) to authenticated;
grant execute on function public.get_household_snapshot(uuid) to authenticated;
grant execute on function public.apply_change(jsonb) to authenticated;
grant execute on function private._lock_lot(uuid, text, text) to authenticated;
grant execute on function private._assert_location(uuid, uuid) to authenticated;
grant execute on function private._insert_lot(uuid, jsonb) to authenticated;
grant execute on function private._reduce_lot(public.inventory_lots, numeric, text) to authenticated;
grant execute on function private._record(uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function private._lot_input(public.inventory_lots) to authenticated;
grant execute on function private.is_valid_date_value(text, text) to authenticated, service_role;
grant execute on function public.seed_household(text, text, jsonb) to service_role;
