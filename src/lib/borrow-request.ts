import type { BorrowRequest } from '@/types'

/** 申请人只能在申请仍待审批、且没有任何审批步骤被处理时编辑。 */
export function canEditBorrowRequest(request: BorrowRequest, userId?: string | null): boolean {
  if (!userId || request.requester_id !== userId || request.status !== 'pending' || request.borrow_type === 'transfer') {
    return false
  }

  return !(request.approval_records || []).some(
    (record) => record.action !== null || record.acted_at !== null,
  )
}
