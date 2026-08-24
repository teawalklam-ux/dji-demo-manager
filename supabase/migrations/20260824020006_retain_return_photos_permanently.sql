-- Production migration: 20260824020006_retain_return_photos_permanently.
-- Return-photo evidence and metadata are retained permanently. Age-based
-- deletion is removed from the cleanup Edge Function in the same release.

drop policy if exists "管理员可删除归还照片" on public.return_photos;

revoke update, delete on table public.return_photos
from public, anon, authenticated;

-- Prevent deleting a borrow record from cascading into retained photo metadata.
-- Database owners can still perform an intentional, audited manual deletion by
-- deleting the photo record first when legally required.
alter table public.return_photos
  drop constraint if exists return_photos_borrow_record_id_fkey;

alter table public.return_photos
  add constraint return_photos_borrow_record_id_fkey
  foreign key (borrow_record_id)
  references public.borrow_records(id)
  on delete restrict;

-- This partial index only served the retired age-based cleanup query.
drop index if exists public.idx_return_photos_photo_deleted_at;

comment on table public.return_photos is
  '归还水印照片及拍摄元数据永久保留，不按创建时间自动清理';

comment on column public.return_photos.photo_deleted_at is
  '仅兼容永久保留策略启用前的历史清理记录；新记录不得按保留期限自动设置';

comment on table public.storage_cleanup_queue is
  '仅用于明确删除符合条件的测试或取消记录后清理无主 Storage 对象，不执行按年龄清理';
