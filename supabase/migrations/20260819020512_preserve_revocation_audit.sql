-- Preserve revocation history end-to-end. Revocation is a business state
-- transition, not a hard delete of the physical checkout/audit trail.

set local lock_timeout = '5s';

alter table public.borrow_requests
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null,
  add column if not exists revocation_reason text,
  add column if not exists revoked_from_status text;

-- Backfill requests revoked by the legacy function. The operator was not
-- recorded previously, so revoked_by intentionally remains null for those rows.
update public.borrow_requests
set revoked_at = coalesce(revoked_at, updated_at),
    revocation_reason = coalesce(
      nullif(btrim(revocation_reason), ''),
      nullif(btrim(regexp_replace(coalesce(rejection_reason, ''), '^【审批撤销】', '')), ''),
      '历史撤销记录'
    )
where status = 'revoked';

alter table public.borrow_requests
  drop constraint if exists borrow_requests_revocation_metadata_check;
alter table public.borrow_requests
  add constraint borrow_requests_revocation_metadata_check check (
    (
      status = 'revoked'
      and revoked_at is not null
      and nullif(btrim(revocation_reason), '') is not null
    )
    or (
      status <> 'revoked'
      and revoked_at is null
      and revoked_by is null
      and revocation_reason is null
      and revoked_from_status is null
    )
  );

create index if not exists idx_borrow_requests_revoked_at
  on public.borrow_requests (revoked_at desc)
  where status = 'revoked';

comment on column public.borrow_requests.revoked_at is 'Timestamp of the irreversible approval revocation.';
comment on column public.borrow_requests.revoked_by is 'Super administrator who revoked the approved request.';
comment on column public.borrow_requests.revocation_reason is 'Required reason captured when approval is revoked.';
comment on column public.borrow_requests.revoked_from_status is 'Request status immediately before revocation.';

-- Keep physical checkout records as immutable history. Active/overdue records
-- are soft-revoked after inventory is restored instead of being deleted.
alter table public.borrow_records
  drop constraint if exists borrow_records_status_check;
alter table public.borrow_records
  add constraint borrow_records_status_check
  check (status in ('active', 'returned', 'overdue', 'revoked'));

alter table public.borrow_records
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null,
  add column if not exists revocation_reason text,
  add column if not exists revoked_from_status text;

alter table public.borrow_records
  drop constraint if exists borrow_records_revocation_metadata_check;
alter table public.borrow_records
  add constraint borrow_records_revocation_metadata_check check (
    (
      status = 'revoked'
      and revoked_at is not null
      and nullif(btrim(revocation_reason), '') is not null
      and revoked_from_status in ('active', 'overdue')
    )
    or (
      status <> 'revoked'
      and revoked_at is null
      and revoked_by is null
      and revocation_reason is null
      and revoked_from_status is null
    )
  );

create index if not exists idx_borrow_records_revoked_at
  on public.borrow_records (revoked_at desc)
  where status = 'revoked';

alter table public.borrow_request_items
  drop constraint if exists borrow_request_items_status_check;
alter table public.borrow_request_items
  add constraint borrow_request_items_status_check check (
    status in ('pending', 'reserved', 'borrowed', 'returned', 'cancelled', 'invalidated', 'revoked')
  );

-- Historical notifications and stock movements must survive any future hard
-- deletion of a borrow record. Both FK columns are already nullable.
alter table public.overdue_notifications
  drop constraint if exists overdue_notifications_borrow_record_id_fkey;
alter table public.overdue_notifications
  add constraint overdue_notifications_borrow_record_id_fkey
  foreign key (borrow_record_id) references public.borrow_records(id) on delete set null;

alter table public.stock_movements
  drop constraint if exists stock_movements_borrow_record_id_fkey;
alter table public.stock_movements
  add constraint stock_movements_borrow_record_id_fkey
  foreign key (borrow_record_id) references public.borrow_records(id) on delete set null;

create or replace function private.revoke_approval(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_record record;
  v_operator_id uuid := auth.uid();
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_revoked_at timestamptz := now();
begin
  if v_operator_id is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select role
  into v_role
  from public.profiles
  where id = v_operator_id;

  if v_role <> 'super_admin' then
    raise exception '只有超级管理员可以撤销审批' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception '请填写撤销原因' using errcode = '22023';
  end if;

  select *
  into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '申请不存在' using errcode = 'P0002';
  end if;

  if v_request.status not in ('approved', 'borrowed', 'overdue', 'partially_returned', 'returned') then
    raise exception '当前申请不能撤销';
  end if;

  if v_request.status = 'approved' then
    update public.borrow_request_items
    set status = 'revoked',
        updated_at = v_revoked_at
    where request_id = p_request_id
      and status in ('pending', 'reserved');
  elsif v_request.status in ('borrowed', 'overdue', 'partially_returned') then
    for v_record in
      select id, item_id, status
      from public.borrow_records
      where request_id = p_request_id
        and status in ('active', 'overdue')
      order by id
      for update
    loop
      update public.items
      set status = 'in_stock',
          current_borrower_id = null,
          updated_at = v_revoked_at
      where id = v_record.item_id;

      update public.borrow_records
      set status = 'revoked',
          revoked_at = v_revoked_at,
          revoked_by = v_operator_id,
          revocation_reason = v_reason,
          revoked_from_status = v_record.status,
          notes = concat_ws(
            E'\n',
            nullif(notes, ''),
            format('审批撤销：%s', v_reason)
          ),
          updated_at = v_revoked_at
      where id = v_record.id;

      insert into public.stock_movements (
        item_id,
        movement_type,
        borrow_record_id,
        operator_id,
        notes
      ) values (
        v_record.item_id,
        'revoke',
        v_record.id,
        v_operator_id,
        format('撤销审批 - 申请编号: %s - 原因: %s', v_request.request_number, v_reason)
      );
    end loop;

    update public.borrow_request_items
    set status = 'revoked',
        updated_at = v_revoked_at
    where request_id = p_request_id
      and status in ('pending', 'reserved', 'borrowed');
  end if;

  update public.borrow_requests
  set status = 'revoked',
      revoked_at = v_revoked_at,
      revoked_by = v_operator_id,
      revocation_reason = v_reason,
      revoked_from_status = v_request.status,
      rejection_reason = '【审批撤销】' || v_reason,
      updated_at = v_revoked_at
  where id = p_request_id;

  -- Keep completed approval actions intact. The request-level revocation fields
  -- are the canonical revocation audit record; the status trigger only closes
  -- any unexpected pending approval rows.
  insert into public.overdue_notifications (
    borrow_record_id,
    borrower_id,
    notification_type,
    notification_category,
    recipient_id,
    borrow_request_id,
    message,
    is_read
  ) values (
    null,
    v_request.requester_id,
    'push',
    'approval',
    v_request.requester_id,
    p_request_id,
    format('审批已撤销：%s（原因：%s）', v_request.request_number, v_reason),
    false
  );
end;
$function$;

comment on function private.revoke_approval(uuid, text) is
  'Soft-revokes an approved request while preserving approval, checkout, notification, and stock audit history.';

notify pgrst, 'reload schema';
