-- Phân quyền chức năng theo từng tài khoản.
-- Mặc định: chỉ quyền cơ bản (Trang chủ, Tra cứu phụ tùng, Tài khoản). Admin bật thêm từng chức năng.
-- Quyền Cloud giữ nguyên cơ chế cũ (tasco_cloud_permissions).

create table if not exists public.tasco_feature_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  features text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.tasco_feature_permissions enable row level security;
revoke all on public.tasco_feature_permissions from anon, authenticated;

create or replace function public.tasco_feature_keys()
returns text[] language sql immutable set search_path = ''
as $$ select array['rescue','garage','assess','duty','directory','progress','scene','ask','forms'] $$;

-- Admin (cùng tiêu chí với danh bạ) hoặc tài khoản đang hoạt động và được bật chức năng.
create or replace function tasco_dir_private.has_feature(p_feature text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    tasco_dir_private.is_admin()
    or exists (
      select 1 from public.tasco_feature_permissions f
      join public.user_profiles p on p.id = f.user_id
      where f.user_id = (select auth.uid()) and p.status = 'active' and p_feature = any (f.features)
    )
  );
$$;

create or replace function public.tasco_my_features()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'all', tasco_dir_private.is_admin(),
    'features', case when tasco_dir_private.is_admin() then to_jsonb(public.tasco_feature_keys())
      else coalesce((select to_jsonb(f.features) from public.tasco_feature_permissions f where f.user_id = auth.uid()), '[]'::jsonb) end);
$$;

create or replace function public.tasco_list_feature_permissions()
returns table(user_id uuid, email text, features text[], admin boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not tasco_dir_private.is_admin() then
    raise exception 'Chỉ admin được xem phân quyền chức năng.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, coalesce(f.features, '{}'::text[]),
      exists (select 1 from public.user_profiles p where p.id = u.id and lower(p.role) = 'admin')
    from auth.users u left join public.tasco_feature_permissions f on f.user_id = u.id;
end;
$$;

create or replace function public.tasco_set_features(p_user_id uuid, p_features text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare clean text[];
begin
  if not tasco_dir_private.is_admin() then
    raise exception 'Chỉ admin được thay đổi phân quyền chức năng.' using errcode = '42501';
  end if;
  if p_user_id is null or p_features is null then
    raise exception 'Thiếu tài khoản hoặc danh sách quyền.' using errcode = '22004';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Chưa có tài khoản Auth tương ứng.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct k order by k), '{}') into clean
    from unnest(p_features) k where k = any (public.tasco_feature_keys());
  insert into public.tasco_feature_permissions(user_id, features, updated_by, updated_at)
    values (p_user_id, clean, auth.uid(), now())
    on conflict (user_id) do update set features = excluded.features, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('user_id', p_user_id, 'features', to_jsonb(clean));
end;
$$;

revoke all on function public.tasco_my_features(), public.tasco_list_feature_permissions(), public.tasco_set_features(uuid, text[]) from public, anon;
grant execute on function public.tasco_my_features(), public.tasco_list_feature_permissions(), public.tasco_set_features(uuid, text[]) to authenticated;
grant execute on function tasco_dir_private.has_feature(text) to authenticated;

-- Chặn phía máy chủ: Danh bạ & hồ sơ
drop policy if exists tasco_contacts_read on public.tasco_contacts;
create policy tasco_contacts_read on public.tasco_contacts for select to authenticated
  using ((select tasco_dir_private.is_active()) and (select tasco_dir_private.has_feature('directory')));
drop policy if exists tasco_claims_mirror_read on public.tasco_claims_mirror;
create policy tasco_claims_mirror_read on public.tasco_claims_mirror for select to authenticated
  using ((select tasco_dir_private.is_active()) and (select tasco_dir_private.has_feature('directory')));

-- Chặn phía máy chủ: Gara (Cứu hộ cũng đọc danh sách gara)
drop policy if exists tasco_garages_read on public.tasco_rescue_garages;
create policy tasco_garages_read on public.tasco_rescue_garages for select to authenticated
  using ((select tasco_garage_private.tasco_can_manage_garages())
    and ((select tasco_dir_private.has_feature('garage')) or (select tasco_dir_private.has_feature('rescue'))));
drop policy if exists tasco_garages_insert on public.tasco_rescue_garages;
create policy tasco_garages_insert on public.tasco_rescue_garages for insert to authenticated
  with check ((select tasco_garage_private.tasco_can_manage_garages()) and (select tasco_dir_private.has_feature('garage')));
drop policy if exists tasco_garages_update on public.tasco_rescue_garages;
create policy tasco_garages_update on public.tasco_rescue_garages for update to authenticated
  using ((select tasco_garage_private.tasco_can_manage_garages()) and (select tasco_dir_private.has_feature('garage')))
  with check ((select tasco_garage_private.tasco_can_manage_garages()) and (select tasco_dir_private.has_feature('garage')));
drop policy if exists tasco_garages_delete on public.tasco_rescue_garages;
create policy tasco_garages_delete on public.tasco_rescue_garages for delete to authenticated
  using ((select tasco_garage_private.tasco_can_manage_garages()) and (select tasco_dir_private.has_feature('garage')));
