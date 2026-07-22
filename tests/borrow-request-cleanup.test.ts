import assert from 'node:assert/strict'
import {
  getBorrowRequestCleanupReason,
  isDeletableBorrowRequest,
} from '../src/lib/borrow-request-cleanup.ts'

assert.equal(isDeletableBorrowRequest({ borrow_type: '测试', status: 'borrowed' }), true)
assert.equal(isDeletableBorrowRequest({ borrow_type: 'customer', status: 'cancelled' }), true)
assert.equal(isDeletableBorrowRequest({ borrow_type: 'marketing', status: 'returned' }), false)

assert.equal(getBorrowRequestCleanupReason({ borrow_type: '测试', status: 'cancelled' }), 'test_and_cancelled')
assert.equal(getBorrowRequestCleanupReason({ borrow_type: '测试', status: 'approved' }), 'test')
assert.equal(getBorrowRequestCleanupReason({ borrow_type: 'customer', status: 'cancelled' }), 'cancelled')
assert.equal(getBorrowRequestCleanupReason({ borrow_type: 'customer', status: 'approved' }), null)
