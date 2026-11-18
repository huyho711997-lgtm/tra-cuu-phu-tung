-- Kết nối Google Drive (OAuth) để đẩy video/tệp nặng mà Cloudinary miễn phí (100 MB) không nhận.
-- Một dòng duy nhất (id = 1). Bảng chỉ Edge Function `tasco-drive` (service role) truy cập:
-- bật RLS, không tạo policy, thu hồi toàn bộ quyền của anon/authenticated.
create table if not exists public.tasco_drive_config (
  id               int primary key default 1 check (id = 1),
  client_id        text,
  client_secret    text,
  refresh_token    text,
  folder_id        text,
  account_email    text,
  pending_state    text,
  pending_state_at timestamptz,
  connected_at     timestamptz,
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);

alter table public.tasco_drive_config enable row level security;
revoke all on public.tasco_drive_config from anon, authenticated;
comment on table public.tasco_drive_config is 'Cấu hình OAuth Google Drive (client + refresh token + thư mục đích). Chỉ Edge Function tasco-drive truy cập.';
