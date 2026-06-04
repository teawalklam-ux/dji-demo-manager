import { supabase } from '@/lib/supabase'
import type { OverdueNotification } from '@/types'

export const notificationsService = {
  async getMyNotifications(): Promise<OverdueNotification[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('overdue_notifications')
      .select(`
        *,
        borrow_record:borrow_records(*, item:items(*), borrower:profiles(*)),
        borrow_request:borrow_requests(*, item:items(*), requester:profiles(*)),
        recipient:profiles!overdue_notifications_recipient_id_fkey(*)
      `)
      .or(`borrower_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .neq('notification_type', 'wecom') // wecom 类型不在站内展示
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
      .or(`borrower_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .eq('is_read', false)
    if (error) throw error
  },

  async getUnreadCount(): Promise<number> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 0

    const { count, error } = await supabase
      .from('overdue_notifications')
      .select('*', { count: 'exact', head: true })
      .or(`borrower_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .eq('is_read', false)
      .neq('notification_type', 'wecom') // wecom 类型不计入未读
    if (error) throw error
    return count || 0
  },
}
