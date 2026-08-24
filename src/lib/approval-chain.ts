import type { ApprovalChain } from '@/types'

/** 只匹配启用中的专属审批链；没有专属链时才使用 all，不跨借用类型回退。 */
export function getApplicableApprovalChain(
  chains: ApprovalChain[],
  borrowType: string,
): ApprovalChain | undefined {
  return chains.find((chain) => chain.is_active && chain.borrow_type === borrowType)
    || chains.find((chain) => chain.is_active && chain.borrow_type === 'all')
}
