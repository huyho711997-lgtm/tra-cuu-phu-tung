-- Đăng nhập máy tính bằng QR từ app điện thoại.
-- Bảng chỉ được Edge Function `tasco-qr-login` (service role) truy cập:
-- bật RLS, không tạo policy nào, thu hồi toàn bộ quyền của anon/authenticated.
create table if not exists public.tasco_qr_logins (
  id            uuid primary key default gen_random_uuid(),
  code_hash     text not null,                       -- sha256(mã dùng 1 lần trong QR)
  verifier_hash text not null,                       -- sha256(verifier chỉ máy tính giữ trong RAM)
  pin_hash      text not null,                       -- sha256(id:pin) - mã xác nhận 4 số
  status        text not null default 'pending' check (status in ('pending','approved','denied')),
  attempts      int  not null default 0,             -- số lần nhập sai mã 4 số
  user_id       uuid,
  token_hash    text,                                -- hashed_token magic link, trả 1 lần rồi xoá dòng
  ip_hash       text,
  ip_hint       text,                                -- ví dụ 113.22.*.* để hiện trên điện thoại
  ua_label      text,                                -- ví dụ "Chrome · Windows"
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '2 minutes')
);

alter table public.tasco_qr_logins enable row level security;
revoke all on public.tasco_qr_logins from anon, authenticated;
create index if not exists tasco_qr_logins_ip_created_idx on public.tasco_qr_logins (ip_hash, created_at);
create index if not exists tasco_qr_logins_expires_idx on public.tasco_qr_logins (expires_at);
comment on table public.tasco_qr_logins is 'Phiên đăng nhập QR tạm thời (2 phút, dùng 1 lần). Chỉ Edge Function tasco-qr-login truy cập.';
