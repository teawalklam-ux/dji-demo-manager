import assert from 'node:assert/strict'

import { canEditBorrowRequest } from '../src/lib/borrow-request.ts'
import type { BorrowRequest } from '../src/types/index.ts'

const pendingRequest = {
  requester_id: 'user-1',
  status: 'pending',
  approval_records: [
    { action: null, acted_at: null },
    { action: null, acted_at: null },
  ],
} as BorrowRequest

assert.equal(canEditBorrowRequest(pendingRequest, 'user-1'), true)
assert.equal(canEditBorrowRequest(pendingRequest, 'user-2'), false)
assert.equal(canEditBorrowRequest({ ...pendingRequest, status: 'approved' }, 'user-1'), false)
assert.equal(
  canEditBorrowRequest({
    ...pendingRequest,
    approval_records: [{ action: 'approved', acted_at: '2026-08-19T00:00:00Z' }],
  }, 'user-1'),
  false,
)
assert.equal(
  canEditBorrowRequest({
    ...pendingRequest,
    approval_records: [{ action: null, acted_at: '2026-08-19T00:00:00Z' }],
  }, 'user-1'),
  false,
)
