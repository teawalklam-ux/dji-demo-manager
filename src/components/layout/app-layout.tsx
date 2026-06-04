import { Outlet, useLocation, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Package,
  FileText,
  CheckSquare,
  Settings,
  Users,
  Tags,
  GitBranch,
  BarChart3,
  LogOut,
  Bell,
  CheckCheck,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { ROLE_MAP } from '@/lib/constants'
import { useNotifications } from '@/hooks/use-notifications'
import { useState, useRef, useEffect } from 'react'
import type { OverdueNotification } from '@/types'

const mainNavItems = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard },
  { title: '样机管理', href: '/items', icon: Package },
  { title: '借用申请', href: '/borrow/apply', icon: FileText },
  { title: '我的申请', href: '/borrow/my-requests', icon: CheckSquare },
  { title: '审批队列', href: '/approval/queue', icon: CheckSquare, roles: ['super_admin', 'admin', 'approver'] },
  { title: '报表导出', href: '/reports', icon: BarChart3 },
]

const adminNavItems = [
  { title: '用户管理', href: '/admin/users', icon: Users },
  { title: '分类管理', href: '/admin/categories', icon: Tags },
  { title: '审批链配置', href: '/admin/approval-chains', icon: GitBranch },
  { title: '系统设置', href: '/admin/settings', icon: Settings },
]

function AppSidebar() {
  const { profile, signOut, isSuperAdmin, hasRole } = useAuth()
  const location = useLocation()

  const filteredMainNav = mainNavItems.filter(
    item => !item.roles || item.roles.some(r => hasRole(r as any))
  )

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <svg className="h-4 w-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold">DJI 样机管理</h2>
            <p className="text-xs text-muted-foreground">大疆代理商</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 py-2">
          <p className="mb-1 px-2 text-xs font-semibold text-muted-foreground">主菜单</p>
          <SidebarMenu>
            {filteredMainNav.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href))}>
                  <Link to={item.href}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>

        {isSuperAdmin && (
          <div className="px-3 py-2">
            <p className="mb-1 px-2 text-xs font-semibold text-muted-foreground">管理后台</p>
            <SidebarMenu>
              {adminNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={location.pathname.startsWith(item.href)}>
                    <Link to={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">
              {profile?.display_name?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium">{profile?.display_name}</p>
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {ROLE_MAP[profile?.role || 'user']?.label}
            </Badge>
          </div>
          <button onClick={signOut} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="退出登录">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function NotificationItem({ notification, onMarkRead }: { notification: OverdueNotification; onMarkRead: (id: string) => void }) {
  const isApproval = notification.notification_category === 'approval'
  const Icon = isApproval ? Clock : AlertCircle
  const iconColor = isApproval ? 'text-blue-500' : 'text-red-500'

  const handleClick = () => {
    if (!notification.is_read) {
      onMarkRead(notification.id)
    }
  }

  const timeAgo = getTimeAgo(notification.sent_at)

  return (
    <div
      className={`flex gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notification.is_read ? 'bg-muted/30' : ''}`}
      onClick={handleClick}
    >
      <div className="mt-0.5">
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${!notification.is_read ? 'font-medium' : 'text-muted-foreground'}`}>
          {notification.message}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>
      </div>
      {!notification.is_read && (
        <div className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
      )}
    </div>
  )
}

function getTimeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 30) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN')
}

function TopHeader() {
  const { profile } = useAuth()
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
  const [showNotifications, setShowNotifications] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭通知面板
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showNotifications])

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4">
      <SidebarTrigger />
      <div className="flex-1" />
      <div className="relative" ref={notifRef}>
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div className="absolute right-0 top-full mt-2 z-50 w-96 rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-semibold">通知</h3>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
                  <CheckCheck className="mr-1 h-3 w-3" />
                  全部已读
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  暂无通知
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={markAsRead}
                  />
                ))
              )}
            </div>
            {notifications.length > 0 && (
              <div className="border-t px-4 py-2">
                <Link
                  to="/approval/queue"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setShowNotifications(false)}
                >
                  查看审批队列
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="text-sm text-muted-foreground">{profile?.department || ''}</span>
    </header>
  )
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex flex-1 flex-col">
        <TopHeader />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <div className="text-right px-4 py-1 text-[10px] text-muted-foreground/40 select-none">
          v1.14
        </div>
      </div>
    </SidebarProvider>
  )
}
