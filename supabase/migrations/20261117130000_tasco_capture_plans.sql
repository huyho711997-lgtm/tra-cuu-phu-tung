-- Danh sách hạng mục cần chụp (tạo sẵn trên máy tính, app điện thoại tự nhận).
-- plan_key = id album, hoặc 'all' khi chụp không thuộc album nào.
-- Đã áp dụng lên dự án Supabase yxwmcpoklxpzlikxojez ngày 17/11/2026.
create table if not exists public.tasco_capture_plans (
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null check (char_length(plan_key) between 1 and 64),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60),
  updated_at timestamptz not null default now(),
  primary key (owner_id, plan_key)
);
alter table public.tasco_capture_plans enable row level security;
drop policy if exists tasco_capture_plans_select_own on public.tasco_capture_plans;
drop policy if exists tasco_capture_plans_insert_own on public.tasco_capture_plans;
drop policy if exists tasco_capture_plans_update_own on public.tasco_capture_plans;
drop policy if exists tasco_capture_plans_delete_own on public.tasco_capture_plans;
drop policy if exists tasco_cloud_permission_gate on public.tasco_capture_plans;
create policy tasco_capture_plans_select_own on public.tasco_capture_plans for select to authenticated using ((select auth.uid()) = owner_id);
create policy tasco_capture_plans_insert_own on public.tasco_capture_plans for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy tasco_capture_plans_update_own on public.tasco_capture_plans for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy tasco_capture_plans_delete_own on public.tasco_capture_plans for delete to authenticated using ((select auth.uid()) = owner_id);
create policy tasco_cloud_permission_gate on public.tasco_capture_plans as restrictive for all to anon, authenticated
  using ((select public.tasco_cloud_allowed()) and owner_id = (select auth.uid()))
  with check ((select public.tasco_cloud_allowed()) and owner_id = (select auth.uid()));
revoke all on public.tasco_capture_plans from anon;
grant select, insert, update, delete on public.tasco_capture_plans to authenticated;
