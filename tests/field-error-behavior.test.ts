import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { getFirstFieldError } from '../src/lib/field-errors.ts'

const borrowApply = readFileSync(
  new URL('../src/pages/borrow/apply.tsx', import.meta.url),
  'utf8',
)
const newItem = readFileSync(
  new URL('../src/pages/items/new.tsx', import.meta.url),
  'utf8',
)

test('field errors keep validation order for focus and scrolling', () => {
  assert.equal(getFirstFieldError({ name: '请填写名称', model: '请填写型号' }), 'name')
  assert.equal(getFirstFieldError({ name: undefined, model: '请填写型号' }), 'model')
  assert.equal(getFirstFieldError({}), undefined)
})

test('core forms render inline errors and focus the first invalid field', () => {
  for (const source of [borrowApply, newItem]) {
    assert.match(source, /focusFirstFieldError/)
    assert.match(source, /<FieldError/)
    assert.match(source, /aria-invalid=/)
  }
})
