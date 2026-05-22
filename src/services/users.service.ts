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
    const { error } = await supabase.rpc('approve_user', { p_user_id: userId })
    if (error) throw error
  },

  async rejectUser(userId: string): Promise<void> {
    const { error } = await supabase.rpc('reject_user', { p_user_id: userId })
    if (error) throw error
  },

  async resetUserPassword(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/dji-demo-manager/`,
    })
    if (error) throw error
  },

  async inviteUser(email: string, displayName: string, role: UserRole, password: string): Promise<void> {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
          role,
          invite_by_admin: 'true',
        },
      },
    })
    if (error) throw error
  },
}
