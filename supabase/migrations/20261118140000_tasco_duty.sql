-- Lịch trực (đồng bộ 2 chiều với Google Sheet). Mọi truy cập đi qua Edge Function `tasco-duty` (service role):
-- bật RLS, không policy, thu hồi quyền anon/authenticated.
create table if not exists public.tasco_duty_config (
  id              int primary key default 1 check (id = 1),
  spreadsheet_id  text,
  sheet_gid       bigint,
  sheet_title     text,
  last_sync_at    timestamptz,
  last_sync_error text,
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);

create table if not exists public.tasco_duty_shifts (
  duty_date  date primary key,
  weekday    text,
  day_type   text,
  period     text,
  scene      text,          -- Hiện trường
  detail     text,          -- Giám định chi tiết
  sheet_row  int not null,  -- số dòng (1-based) trên Sheet
  synced_at  timestamptz not null default now()
);

create table if not exists public.tasco_duty_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sheet_name text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasco_duty_swaps (
  id             uuid primary key default gen_random_uuid(),
  duty_date      date not null,
  role           text not null check (role in ('scene','detail')),
  from_name      text not null,
  to_name        text not null,
  back_date      date,
  back_role      text check (back_role in ('scene','detail')),
  reason         text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by   uuid not null,
  requester_name text,
  decided_by     uuid,
  decider_name   text,
  decided_at     timestamptz,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists tasco_duty_swaps_status_idx on public.tasco_duty_swaps (status, created_at desc);
create index if not exists tasco_duty_swaps_requester_idx on public.tasco_duty_swaps (requested_by, created_at desc);

alter table public.tasco_duty_config  enable row level security;
alter table public.tasco_duty_shifts  enable row level security;
alter table public.tasco_duty_members enable row level security;
alter table public.tasco_duty_swaps   enable row level security;
revoke all on public.tasco_duty_config, public.tasco_duty_shifts, public.tasco_duty_members, public.tasco_duty_swaps from anon, authenticated;

-- Ghi lại quyền Google đã cấp (để app biết đã có quyền Sheets chưa).
alter table public.tasco_drive_config add column if not exists granted_scope text;
