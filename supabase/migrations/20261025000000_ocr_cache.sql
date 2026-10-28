-- Wordpick shared OCR cache: one row per public Google Drive file.
-- Run once in the Supabase SQL Editor before enabling the website cache.

create table if not exists public.ocr_cache (
  drive_file_id text primary key,
  folder_id text not null,
  file_name text not null,
  image_url text not null,
  ocr_text text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ocr_cache_drive_file_id_format
    check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint ocr_cache_folder_id_format
    check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  constraint ocr_cache_file_name_length
    check (char_length(file_name) between 1 and 512),
  constraint ocr_cache_ocr_text_length
    check (char_length(ocr_text) between 1 and 200000)
);

alter table public.ocr_cache enable row level security;

-- The website backend uses a Supabase secret key. Do not allow direct client access.
revoke all on table public.ocr_cache from public, anon, authenticated;
grant all privileges on table public.ocr_cache to service_role;
