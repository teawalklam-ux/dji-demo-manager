import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import { crmSystemSopGuides } from '../src/pages/sop/crm-system-sops.ts'

assert.deepEqual(
  crmSystemSopGuides.map((guide) => guide.id),
  ['system-crm-login', 'system-crm-customer', 'system-crm-followup'],
)
assert.deepEqual(
  crmSystemSopGuides.map((guide) => Object.values(guide.stages).flat().length),
  [4, 7, 7],
)

const steps = crmSystemSopGuides.flatMap((guide) => Object.values(guide.stages).flat())
assert.equal(steps.length, 18)
assert.equal(new Set(steps.map((step) => step.id)).size, steps.length)
assert.equal(steps.every((step) => step.label.trim().length > 0), true)

const allLabels = steps.map((step) => step.label).join('\n')
for (const requiredText of [
  '深圳市一探疆来科技有限公司',
  '客户名称（只读）',
  '今日水印相机',
  '关联业务数据',
  '行业负责人田潇、财务部林芷因、总经办马总',
  '关联 CRM 对象',
]) {
  assert.match(allLabels, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

for (const step of steps) {
  assert.equal(
    existsSync(new URL(`../public/sop-steps/${step.id}.jpg`, import.meta.url)),
    true,
    `missing bundled screenshot for ${step.id}`,
  )
}

const migration = readFileSync(
  new URL('../supabase/migrations/20260907102719_add_crm_system_sop_guides.sql', import.meta.url),
  'utf8',
)
const migrationPayload = migration.match(/\$crm_sop\$\s*([\s\S]*?)\s*\$crm_sop\$/)?.[1]
assert.ok(migrationPayload, 'migration must contain the CRM SOP JSON payload')

const databaseGuides = JSON.parse(migrationPayload)
assert.deepEqual(
  databaseGuides.map(({ id, title, description, icon_key: iconKey, stages }: {
    id: string
    title: string
    description: string
    icon_key: CrmIconKey
    stages: (typeof crmSystemSopGuides)[number]['stages']
  }) => ({ id, title, description, iconKey, requiredRole: 'user', roleGroup: 'user', stages })),
  crmSystemSopGuides,
)

type CrmIconKey = (typeof crmSystemSopGuides)[number]['iconKey']
