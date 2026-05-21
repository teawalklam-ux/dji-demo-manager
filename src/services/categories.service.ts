import { supabase } from '@/lib/supabase'
import type { Category } from '@/types'

export const categoriesService = {
  async getAll(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order')
    if (error) throw error
    return data || []
  },

  async create(data: { name: string; code: string; description?: string; icon_name?: string; sort_order?: number }): Promise<Category> {
    const { data: category, error } = await supabase
      .from('categories')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    return category
  },

  async update(id: string, data: Partial<{ name: string; code: string; description: string; icon_name: string; sort_order: number }>): Promise<Category> {
    const { data: category, error } = await supabase
      .from('categories')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return category
  },

  async toggleActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('categories').update({ is_active: isActive }).eq('id', id)
    if (error) throw error
  },
}
