-- Only non-secret presentation/notification preferences belong here.
create table public.system_settings (
  id boolean primary key default true check (id),
  barcode_prefix text not null default 'DJI' check (char_length(btrim(barcode_prefix)) between 1 and 32),
  default_borrow_days integer not null default 14 check (default_borrow_days between 1 and 3650),
  overdue_remind_days integer not null default 1 check (overdue_remind_days between 0 and 3650),
  overdue_email_notify boolean not null default true,
  overdue_wecom_notify boolean not null default false
);

insert into public.system_settings (id) values (true);
alter table public.system_settings enable row level security;
revoke all on public.system_settings from public, anon, authenticated;
grant select on public.system_settings to authenticated, service_role;
grant update (barcode_prefix, default_borrow_days, overdue_remind_days, overdue_email_notify, overdue_wecom_notify)
  on public.system_settings to authenticated;

create policy system_settings_read on public.system_settings
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  ));

create policy system_settings_update on public.system_settings
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active' and p.role = 'super_admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active' and p.role = 'super_admin'
  ));
