import { supabase } from '@/lib/supabase'
import type { OverdueNotification } from '@/types'

export const notificationsService = {
  async getMyNotifications(): Promise<OverdueNotification[]> {
    const { data, error } = await supabase
      .from('overdue_notifications')
      .select('*, borrow_record:borrow_records(*, item:items(*), borrower:profiles(*))')
      .order('sent_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  },

  async markAsRead(id: string): Promise<void> {
    const { error } = await supabase
      .from('overdue_notifications')
      .update({ is_read: true })
      .eq('id', id)
    if (error) throw error
  },

  async markAllAsRead(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('overdue_notifications')
      .update({ is_read: true })
      .eq('borrower_id', user.id)
      .eq('is_read', false)
    if (error) throw error
  },

  async getUnreadCount(): Promise<number> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 0

    const { count, error } = await supabase
      .from('overdue_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('borrower_id', user.id)
      .eq('is_read', false)
    if (error) throw error
    return count || 0
  },
}
