import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { defaultReturnDate, defaultSettings, validateSettings } from '../src/lib/system-settings.ts'

test('settings validate ranges, preserve zero, and exclude legacy secrets', () => {
  assert.deepEqual(validateSettings({ ...defaultSettings, overdue_remind_days: 0, wecom_webhook_url: 'secret' } as typeof defaultSettings), { ...defaultSettings, overdue_remind_days: 0 })
  for (const days of [0, -1, 1.5, NaN, 3651]) {
    assert.throws(() => validateSettings({ ...defaultSettings, default_borrow_days: days }))
  }
  assert.throws(() => validateSettings({ ...defaultSettings, barcode_prefix: ' ' }))
  assert.throws(() => validateSettings({ ...defaultSettings, overdue_remind_days: -1 }))
  assert.equal(defaultReturnDate('2028-02-28', 2), '2028-03-01')
  assert.equal(defaultReturnDate('2026-12-31', 7), '2027-01-07')
  assert.equal(defaultReturnDate('', 14), '')
})

// Execute the actual Edge handler with mocked database/network boundaries.
const edgeSource = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/check-overdue/index.ts', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, ''))

test('settings service reads shared row, confirms saves, and surfaces RLS/network failures', async () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/services/settings.service.ts', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace('export const settingsService', 'const settingsService'))
  let result: { data: typeof defaultSettings | null; error: Error | null } = { data: { ...defaultSettings, default_borrow_days: 30 }, error: null }
  let updated: unknown
  const query = {
    select() { return query },
    eq(key: string, value: unknown) { assert.equal(key, 'id'); assert.equal(value, true); return query },
    update(value: unknown) { updated = value; return query },
    single: async () => result,
  }
  const service = new Function('supabase', 'validateSettings', `${source}; return settingsService`)(
    { from(table: string) { assert.equal(table, 'system_settings'); return query } }, validateSettings,
  )
  assert.equal((await service.get()).default_borrow_days, 30)
  await service.update({ ...defaultSettings, overdue_remind_days: 0, wecom_webhook_url: 'secret' })
  assert.deepEqual(updated, { ...defaultSettings, overdue_remind_days: 0 })
  result = { data: null, error: new Error('RLS denied or zero rows') }
  await assert.rejects(service.get(), /RLS denied/)
  await assert.rejects(service.update(defaultSettings), /RLS denied/)
})

for (const scenario of [
  { enabled: true, calls: 1, count: 1 },
  { enabled: false, calls: 0, count: 0 },
  { enabled: true, settingsError: true, calls: 0, count: 0 },
  { enabled: true, missing: true, calls: 0, count: 0 },
  { enabled: true, webhookMissing: true, calls: 0, count: 0 },
  { enabled: true, deliveryError: true, calls: 1, count: 0 },
]) {
  test(`overdue workflow ${JSON.stringify(scenario)}`, async () => {
    let handler: (request: Request) => Promise<Response> = null!
    let calls = 0
    const mutations: string[] = []
    const record = { id: 'r1', item_id: 'i1', borrower_id: 'u1', borrow_date: '2020-01-01', due_date: '2020-01-02', items: { name: 'Demo' }, profiles: { phone: '123' } }
    const client = { from(table: string) {
      let operation = 'select'
      const query = {
        select() { return query }, eq() { return query }, lt() { return query }, in() { return query },
        update() { operation = 'update'; return query }, insert() { operation = 'insert'; return query },
        single() { return query },
        then(resolve: (result: unknown) => unknown) {
          if (operation !== 'select') mutations.push(`${table}:${operation}`)
          return Promise.resolve(resolve(table === 'system_settings'
            ? { data: scenario.missing ? null : { overdue_wecom_notify: scenario.enabled }, error: scenario.settingsError ? { message: 'unavailable' } : null }
            : { data: table === 'borrow_records' && operation === 'select' ? [record] : null, error: null }))
        },
      }
      return query
    } }
    new Function('serve', 'createClient', 'Deno', 'fetch', 'console', edgeSource)(
      (callback: typeof handler) => { handler = callback }, () => client,
      { env: { get: (key: string) => key === 'WECOM_WEBHOOK_URL' && scenario.webhookMissing ? undefined : 'test' } },
      async () => { calls++; return Response.json({ errcode: scenario.deliveryError ? 400 : 0 }) },
      { log() {}, error() {} },
    )
    const response = await handler(new Request('https://local.test', { headers: { authorization: 'Bearer test' } }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).wecomNotifiedCount, scenario.count)
    assert.equal(calls, scenario.calls)
    assert.ok(mutations.includes('borrow_records:update'))
    assert.ok(mutations.includes('items:update'))
    assert.ok(mutations.includes('overdue_notifications:insert'))
  })
}
