import { useState, useEffect, useCallback } from 'react'
import type { BorrowRequest } from '@/types'
import { borrowService } from '@/services/borrow.service'

export function useBorrowRequests() {
  const [requests, setRequests] = useState<BorrowRequest[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await borrowService.getMyRequests()
      setRequests(data)
    } catch (error) {
      console.error('Failed to fetch requests:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { requests, loading, refetch: fetchData }
}
