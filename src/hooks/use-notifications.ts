import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { notificationsService } from '@/services/notifications.service'
import type { OverdueNotification } from '@/types'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<OverdueNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
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

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead }
}
