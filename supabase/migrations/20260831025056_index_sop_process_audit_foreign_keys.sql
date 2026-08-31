-- Follow-up for environments where the SOP persistence migration was already
-- applied before the database advisor pass.
create index if not exists sop_processes_created_by_idx
on public.sop_processes (created_by);

create index if not exists sop_processes_updated_by_idx
on public.sop_processes (updated_by);
