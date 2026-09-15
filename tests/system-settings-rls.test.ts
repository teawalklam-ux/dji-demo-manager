import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('global settings migration enforces permissions and constraints in PostgreSQL', async () => {
  const db = new PGlite()
  try {
    // Minimal Supabase auth/profile boundary; policies run as non-owner roles.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.profiles (id uuid primary key, role text, status text);
      alter table public.profiles enable row level security;
      grant select on public.profiles to authenticated;
      create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
    `)
    await db.exec(readFileSync(new URL('../supabase/migrations/20260915015532_global_system_settings.sql', import.meta.url), 'utf8'))
    const id = '00000000-0000-0000-0000-000000000001'
    await db.query('insert into profiles values ($1, $2, $3)', [id, 'super_admin', 'active'])
    for (const status of ['active', 'disabled', 'pending_approval']) {
      for (const role of ['super_admin', 'admin', 'approver', 'user']) {
        await db.query('update profiles set role = $1, status = $2', [role, status])
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
        await db.exec('set role authenticated')
        assert.equal((await db.query('select * from system_settings')).rows.length, status === 'active' ? 1 : 0, `${status}/${role} read`)
        assert.equal((await db.query('update system_settings set default_borrow_days = 21 returning id')).rows.length, status === 'active' && role === 'super_admin' ? 1 : 0, `${status}/${role} write`)
        await assert.rejects(db.exec('insert into system_settings (id) values (true)'), /permission denied/)
        await assert.rejects(db.exec('delete from system_settings'), /permission denied/)
        await db.exec('reset role')
      }
    }
    await db.exec('set role anon')
    await assert.rejects(db.exec('select * from system_settings'), /permission denied/)
    await db.exec('reset role')
    await db.exec('delete from profiles; set role authenticated')
    assert.equal((await db.query('select * from system_settings')).rows.length, 0)
    await db.exec('reset role')
    await assert.rejects(db.exec('update system_settings set default_borrow_days = 0'), /check constraint/)
    await assert.rejects(db.exec('update system_settings set overdue_remind_days = -1'), /check constraint/)
    await assert.rejects(db.exec("update system_settings set barcode_prefix = ' '"), /check constraint/)
    await assert.rejects(db.exec('insert into system_settings (id) values (false)'), /check constraint/)
    await db.exec('update system_settings set overdue_remind_days = 0')
    assert.equal((await db.query<{ default_borrow_days: number }>('select default_borrow_days from system_settings')).rows[0].default_borrow_days, 21)
  } finally {
    await db.close()
  }
})
