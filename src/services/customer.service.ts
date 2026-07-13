import { supabase } from '@/lib/supabase'
import type { UserCustomer } from '@/types'

export const customerService = {
  /** 获取当前用户的客户地址簿 */
  async getMine(): Promise<UserCustomer[]> {
    const { data, error } = await supabase
      .from('user_customers')
      .select('*')
      .order('customer_name', { ascending: true })
    if (error) throw error
    return data || []
  },

  /** 超级管理员：获取所有用户的客户（含用户信息） */
  async getAll(): Promise<UserCustomer[]> {
    const { data, error } = await supabase
      .from('user_customers')
      .select('*, user:profiles(*)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  /** 保存客户到地址簿（重复时静默跳过） */
  async save(customerName: string, customerContact?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { error } = await supabase
      .from('user_customers')
      .insert({
        user_id: user.id,
        customer_name: customerName.trim(),
        customer_contact: customerContact?.trim() || null,
      })
    // 唯一约束冲突时静默跳过（23505 = unique_violation）
    if (error && error.code !== '23505') throw error
  },

  /** 删除客户 */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('user_customers')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
