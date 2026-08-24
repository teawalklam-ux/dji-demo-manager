import assert from 'node:assert/strict'

import { getApplicableApprovalChain } from '../src/lib/approval-chain.ts'
import type { ApprovalChain } from '../src/types/index.ts'

function chain(id: string, borrowType: string, isActive = true): ApprovalChain {
  return {
    id,
    name: id,
    borrow_type: borrowType,
    steps: [],
    max_borrow_days: null,
    is_active: isActive,
    created_at: '',
    updated_at: '',
  }
}

const chains = [
  chain('customer', 'customer'),
  chain('transfer', 'transfer'),
  chain('fallback', 'all'),
]

assert.equal(getApplicableApprovalChain(chains, 'transfer')?.id, 'transfer')
assert.equal(getApplicableApprovalChain(chains, 'customer')?.id, 'customer')
assert.equal(
  getApplicableApprovalChain([
    chain('customer', 'customer'),
    chain('transfer', 'transfer', false),
    chain('fallback', 'all'),
  ], 'transfer')?.id,
  'fallback',
)
assert.equal(getApplicableApprovalChain([chain('customer', 'customer')], 'transfer'), undefined)
