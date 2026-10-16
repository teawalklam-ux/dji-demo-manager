import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const approvalFunction = readFileSync(
  new URL('../supabase/functions/notify-approval/index.ts', import.meta.url),
  'utf8',
)
const borrowService = readFileSync(
  new URL('../src/services/borrow.service.ts', import.meta.url),
  'utf8',
)
const approvalService = readFileSync(
  new URL('../src/services/approval.service.ts', import.meta.url),
  'utf8',
)

test('approval notification embeds the real request-item relationship through an alias', () => {
  assert.match(
    approvalFunction,
    /request_items:borrow_request_items\s*\(\s*items\s*\(name, model, barcode\)\s*\)/,
  )
  assert.doesNotMatch(approvalFunction, /\n\s+request_items\s*\(/)
})

test('approval notification failures are observable and do not create false delivery markers', () => {
  assert.match(approvalFunction, /WECOM_WEBHOOK_URL is not configured[^]*}, 500\)/)
  assert.match(approvalFunction, /failedCount > 0 \? 502 : 200/)
  assert.match(approvalFunction, /throw new Error\(`Failed to record WeCom deliveries:/)
  assert.match(approvalFunction, /const unsentByRecipient = new Map/)

  for (const source of [borrowService, approvalService]) {
    assert.match(source, /const response = await fetch\(`\$\{supabaseUrl\}\/functions\/v1\/notify-approval`/)
    assert.match(source, /if \(!response\.ok\)/)
    assert.match(source, /企业微信审批通知失败（HTTP \$\{response\.status\}）/)
  }
})
