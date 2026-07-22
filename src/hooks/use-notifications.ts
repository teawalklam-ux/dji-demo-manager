import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { notificationsService } from '@/services/notifications.service'
import { supabase } from '@/lib/supabase'
import type { OverdueNotification } from '@/types'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<OverdueNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const loadNotifications = useCallback(async () => {
    if (!user) return
    setLoading(true)
    Promise.all([
      notificationsService.getMyNotifications(),
      notificationsService.getUnreadCount(),
    ])
      .then(([notifs, count]) => {
        setNotifications(notifs)
        setUnreadCount(count)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNotifications()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadNotifications])

  // Realtime 订阅：监听新通知
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'overdue_notifications',
        },
        (payload) => {
          const newNotif = payload.new as Partial<OverdueNotification>
          // 只处理发给当前用户的通知
          if (
            newNotif &&
            (newNotif.borrower_id === user.id || newNotif.recipient_id === user.id) &&
            newNotif.notification_type !== 'wecom'
          ) {
            // 刷新通知列表
            loadNotifications()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, loadNotifications])

  async function markAsRead(id: string) {
    await notificationsService.markAsRead(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllAsRead() {
    await notificationsService.markAllAsRead()
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh: loadNotifications }
}
