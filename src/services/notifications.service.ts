import { supabase } from '@/lib/supabase'
import type { OverdueNotification } from '@/types'

export const notificationsService = {
  async getMyNotifications(): Promise<OverdueNotification[]> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return demoApi.getNotifications()
      }
    }

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
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        await demoApi.markNotificationRead(id)
        return
      }
    }

    const { error } = await supabase
      .from('overdue_notifications')
      .update({ is_read: true })
      .eq('id', id)
    if (error) throw error
  },

  async markAllAsRead(): Promise<void> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        await demoApi.markAllNotificationsRead()
        return
      }
    }

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
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return (await demoApi.getUnreadCount()).count
      }
    }

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
