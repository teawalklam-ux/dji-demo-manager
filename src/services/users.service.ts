import { supabase } from '@/lib/supabase'
import type { Profile, UserRole, UserStatus } from '@/types'

export const usersService = {
  async getAll(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async getActive(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'active')
      .order('display_name')
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

  async updateStatus(userId: string, status: UserStatus): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', userId)
    if (error) throw error
  },

  async updateUser(userId: string, updates: Partial<Pick<Profile, 'display_name' | 'phone' | 'department' | 'role'>>): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
    if (error) throw error
  },

  async approveUser(userId: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw error
  },

  async rejectUser(userId: string): Promise<void> {
    // 拒绝用户：禁用该用户 profile，阻止其登录使用系统
    const { error } = await supabase
      .from('profiles')
      .update({ status: 'disabled', updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw error
  },

  async resetUserPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/dji-demo-manager/reset-password`,
    })
    if (error) throw error
  },

  async transferSuperAdmin(newSuperAdminId: string): Promise<void> {
    const { error } = await supabase.rpc('transfer_super_admin', {
      p_new_super_admin_id: newSuperAdminId,
    })
    if (error) throw error
  },

  async inviteUser(email: string, displayName: string, role: UserRole, password: string): Promise<{ action: string; message: string }> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error('未登录，无法邀请用户')
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, displayName, role, password }),
      }
    )

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || '操作失败')
    }

    return { action: result.action || 'created', message: result.message || '成功' }
  },
}
