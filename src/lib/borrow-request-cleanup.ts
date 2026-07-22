export const TEST_BORROW_TYPE = '测试'

export function isDeletableBorrowRequest(request: { borrow_type: string; status: string }): boolean {
  return request.borrow_type === TEST_BORROW_TYPE || request.status === 'cancelled'
}

export function getBorrowRequestCleanupReason(
  request: { borrow_type: string; status: string }
): 'test' | 'cancelled' | 'test_and_cancelled' | null {
  const isTest = request.borrow_type === TEST_BORROW_TYPE
  const isCancelled = request.status === 'cancelled'
  if (isTest && isCancelled) return 'test_and_cancelled'
  if (isTest) return 'test'
  if (isCancelled) return 'cancelled'
  return null
}
