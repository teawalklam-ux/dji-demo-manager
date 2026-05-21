import { useState, useEffect } from 'react'
import type { Category } from '@/types'
import { categoriesService } from '@/services/categories.service'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    categoriesService.getAll()
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { categories, loading }
}
