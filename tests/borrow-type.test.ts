import assert from 'node:assert/strict'
import { getBorrowTypeInfo, getBorrowTypeOptions } from '../src/lib/constants.ts'

assert.equal(getBorrowTypeInfo('customer').label, '客户试用')
assert.equal(getBorrowTypeInfo('内部培训').label, '内部培训')

assert.deepEqual(
  getBorrowTypeOptions(['all', 'customer', '内部培训', '内部培训', 'marketing']),
  [
    { value: 'customer', label: '客户试用' },
    { value: 'marketing', label: '营销演示' },
    { value: '内部培训', label: '内部培训' },
  ]
)
