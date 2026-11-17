-- Nét đánh dấu trên ảnh (lưu riêng, không đụng ảnh gốc)
alter table public.tasco_personal_photos
  add column if not exists annotations jsonb;

alter table public.tasco_personal_photos
  drop constraint if exists tasco_personal_photos_annotations_chk;
alter table public.tasco_personal_photos
  add constraint tasco_personal_photos_annotations_chk
  check (
    annotations is null
    or (
      jsonb_typeof(annotations) = 'object'
      and jsonb_typeof(annotations->'items') = 'array'
      and jsonb_array_length(annotations->'items') <= 80
      and pg_column_size(annotations) <= 32768
    )
  );

comment on column public.tasco_personal_photos.annotations is
  'Nét đánh dấu trên ảnh (mũi tên, vòng tròn, khung, số, chữ) dạng JSON {v:1,items:[...]}, toạ độ tỉ lệ 0..1; không sửa ảnh gốc.';
