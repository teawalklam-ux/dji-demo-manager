import { useState, useEffect, useCallback } from 'react'
import type { ApprovalRecord } from '@/types'
import { approvalService } from '@/services/approval.service'

export function useApprovals() {
  const [pending, setPending] = useState<ApprovalRecord[]>([])
  const [processed, setProcessed] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [pendingData, processedData] = await Promise.all([
        approvalService.getPendingApprovals(),
        approvalService.getProcessedApprovals(),
      ])
      setPending(pendingData)
      setProcessed(processedData)
    } catch (error) {
      console.error('Failed to fetch approvals:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { pending, processed, loading, refetch: fetchData }
}
