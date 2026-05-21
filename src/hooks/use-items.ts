import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Item, ItemFilters } from '@/types'
import { itemsService } from '@/services/items.service'

export function useItems(filters?: ItemFilters) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(0)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await itemsService.getAll(filters)
      setItems(result.data)
      setCount(result.count)
    } catch (error) {
      console.error('Failed to fetch items:', error)
    } finally {
      setLoading(false)
    }
  }, [filters?.search, filters?.category_id, filters?.status])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('items-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
        fetchData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  return { items, loading, count, refetch: fetchData }
}
