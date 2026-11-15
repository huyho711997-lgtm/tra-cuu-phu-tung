-- Hạng mục chụp do người dùng tự nhập (vd "Cản trước - trầy xước"). NULL = chưa phân hạng mục.
-- Đã áp dụng lên dự án Supabase yxwmcpoklxpzlikxojez ngày 15/11/2026.
alter table public.tasco_personal_photos add column if not exists category text;
alter table public.tasco_personal_photos drop constraint if exists tasco_personal_photos_category_check;
alter table public.tasco_personal_photos add constraint tasco_personal_photos_category_check check (category is null or char_length(category) <= 120);
create index if not exists tasco_personal_photos_owner_category_idx on public.tasco_personal_photos (owner_id, category) where category is not null;
