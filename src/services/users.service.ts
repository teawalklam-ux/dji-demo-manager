import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types'

export const usersService = {
  async getAll(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async updateRole(userId: string, role: UserRole): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId)
    if (error) throw error
  },

  async toggleActive(userId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId)
    if (error) throw error
  },

  async inviteUser(email: string, displayName: string, role: UserRole, password: string): Promise<void> {
    // 使用 Supabase Admin API 创建用户
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
          role,
        },
      },
    })
    if (error) throw error
  },
}
