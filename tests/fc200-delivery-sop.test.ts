import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { fc200DeliverySop } from '../src/pages/sop/fc200-delivery-sop.ts'

const stageEntries = Object.entries(fc200DeliverySop.stages)
const items = stageEntries.flatMap(([, stageItems]) => stageItems)

assert.equal(fc200DeliverySop.id, 'fc200-customer-delivery')
assert.deepEqual(stageEntries.map(([stage]) => stage), ['materials', 'workflow', 'followup'])
assert.deepEqual(stageEntries.map(([, stageItems]) => stageItems.length), [13, 51, 11])
assert.equal(new Set(items.map((item) => item.id)).size, items.length)
assert.equal(items.every((item) => item.label.length > 0 && item.label.length <= 80), true)

const allLabels = items.map((item) => item.label).join('\n')
for (const requiredText of [
  '每单提交《DJI大疆运载广东交付收集表》',
  '桨叶缓慢展至180°',
  '喷涂WD40后插拔母端2-3次',
  '模块5/6按客户类型执行，模块7均选做',
  '持有效CAAC大型无人机执照者',
  '满意度问卷由运服自动推送',
]) {
  assert.match(allLabels, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

const migration = readFileSync(
  new URL('../supabase/migrations/20260907085558_add_fc200_customer_delivery_sop.sql', import.meta.url),
  'utf8',
)
assert.match(migration, /fc200-customer-delivery/)
assert.match(migration, /V2\.3确认书/)
assert.match(migration, /模块7所有用户均选做/)

const migrationStages = migration.match(/\$sop\$\s*([\s\S]*?)\s*\$sop\$/)?.[1]
assert.ok(migrationStages, 'migration must contain the SOP JSON payload')
assert.deepEqual(JSON.parse(migrationStages), fc200DeliverySop.stages)
