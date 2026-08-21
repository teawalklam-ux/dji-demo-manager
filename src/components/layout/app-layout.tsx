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
  Contact,
  Trash2,
  BarChart3,
  LogOut,
  Bell,
  CheckCheck,
  Clock,
  AlertCircle,
  History,
  type LucideIcon,
} from 'lucide-react'
import { ROLE_MAP } from '@/lib/constants'
import { APP_VERSION } from '@/lib/version'
import { useNotifications } from '@/hooks/use-notifications'
import { useState, useRef, useEffect } from 'react'
import type { OverdueNotification, UserRole } from '@/types'

interface MainNavItem {
  title: string
  href: string
  icon: LucideIcon
  roles?: UserRole[]
}

const mainNavItems: MainNavItem[] = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard },
  { title: '样机管理', href: '/items', icon: Package },
  { title: '借用申请', href: '/borrow/apply', icon: FileText },
  { title: '我的申请', href: '/borrow/my-requests', icon: CheckSquare },
  { title: '审批队列', href: '/approval/queue', icon: CheckSquare },
  { title: '报表导出', href: '/reports', icon: BarChart3 },
]

const adminNavItems = [
  { title: '申请历史', href: '/admin/request-history', icon: History, superAdminOnly: false },
  { title: '用户管理', href: '/admin/users', icon: Users, superAdminOnly: true },
  { title: '客户地址簿', href: '/admin/customers', icon: Contact, superAdminOnly: true },
  { title: '分类管理', href: '/admin/categories', icon: Tags, superAdminOnly: false },
  { title: '审批链配置', href: '/admin/approval-chains', icon: GitBranch, superAdminOnly: false },
  { title: '记录清理', href: '/admin/request-cleanup', icon: Trash2, superAdminOnly: false },
  { title: '系统设置', href: '/admin/settings', icon: Settings, superAdminOnly: true },
]

function AppSidebar() {
  const { profile, signOut, isSuperAdmin, isAdmin, hasRole, isDemoMode } = useAuth()
  const location = useLocation()

  const filteredMainNav = mainNavItems.filter(
    item => (!item.roles || item.roles.some(r => hasRole(r)))
      && (!isDemoMode || item.href === '/' || item.href === '/items')
  )

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-sidebar-primary text-sidebar-primary-foreground">
            <img
              src={`${import.meta.env.BASE_URL}dji-logo-white.png`}
              alt="DJI"
              className="h-5 w-7 object-contain"
            />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-sm font-semibold tracking-[-0.015em] text-sidebar-foreground">样机管理系统</h2>
            <p className="mt-0.5 truncate text-xs text-[var(--color-sidebar-muted)]">深圳市一探疆来科技有限公司</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-4 px-3 py-5">
        <div>
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-[var(--tracking-label)] text-[var(--color-sidebar-muted)]">工作区</p>
          <SidebarMenu>
            {filteredMainNav.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={
                    location.pathname === item.href
                    || (item.href !== '/' && location.pathname.startsWith(item.href))
                    || (
                      item.href === '/borrow/my-requests'
                      && location.pathname.startsWith('/borrow/requests/')
                    )
                  }
                  className="hm-sidebar-link h-10 rounded-[var(--radius-input)] px-3 text-sidebar-foreground/70 hover:text-sidebar-foreground data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground"
                >
                  <Link to={item.href}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </div>

        {isAdmin && (
          <div>
            <p className="mb-2 px-3 text-[11px] font-semibold tracking-[var(--tracking-label)] text-[var(--color-sidebar-muted)]">管理</p>
            <SidebarMenu>
              {adminNavItems
                .filter(item => !item.superAdminOnly || isSuperAdmin)
                .map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith(item.href)}
                    className="hm-sidebar-link h-10 rounded-[var(--radius-input)] px-3 text-sidebar-foreground/70 hover:text-sidebar-foreground data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground"
                  >
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

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-sidebar-border bg-sidebar-accent/45 p-2.5">
          <Avatar className="h-9 w-9 border border-sidebar-border">
            <AvatarFallback className="bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {profile?.display_name?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{profile?.display_name}</p>
            <Badge variant="outline" className="mt-1 border-sidebar-border bg-transparent px-1.5 py-0 text-[10px] text-[var(--color-sidebar-muted)]">
              {ROLE_MAP[profile?.role || 'user']?.label}
            </Badge>
          </div>
          <button
            onClick={signOut}
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-[var(--color-sidebar-muted)] transition-[color,background-color,transform] duration-short ease-hm-out hover:bg-sidebar-accent hover:text-sidebar-foreground active:translate-y-px"
            title="退出登录"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function NotificationItem({ notification, onMarkRead }: { notification: OverdueNotification; onMarkRead: (id: string) => void }) {
  const isApproval = notification.notification_category === 'approval'
  const isReservation = notification.notification_category === 'reservation'
  const Icon = isApproval ? Clock : AlertCircle
  const iconColor = isApproval ? 'text-info' : isReservation ? 'text-warning' : 'text-destructive'

  const handleClick = () => {
    if (!notification.is_read) {
      onMarkRead(notification.id)
    }
  }

  const timeAgo = getTimeAgo(notification.sent_at)

  return (
    <div
      className={`flex cursor-pointer gap-3 p-3 transition-[background-color,color] duration-micro ease-hm-out hover:bg-muted/50 ${!notification.is_read ? 'bg-muted/30' : ''}`}
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
  const { profile, isDemoMode } = useAuth()
  const location = useLocation()
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

  const currentSection = (() => {
    if (location.pathname === '/') return '运行总览'
    if (location.pathname.startsWith('/items')) return '样机管理'
    if (location.pathname.startsWith('/borrow/apply')) return '借用申请'
    if (location.pathname.startsWith('/borrow')) return '我的申请'
    if (location.pathname.startsWith('/approval')) return '审批队列'
    if (location.pathname.startsWith('/reports')) return '报表导出'
    if (location.pathname.startsWith('/admin/request-history')) return '申请历史'
    if (location.pathname.startsWith('/admin')) return '管理后台'
    return '工作区'
  })()

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-3 sm:gap-4 sm:px-6">
      <SidebarTrigger className="size-10" aria-label="切换侧栏" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{currentSection}</p>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">DJI 样机管理系统</p>
      </div>
      <div className="relative" ref={notifRef}>
        <button
          className="relative flex size-11 items-center justify-center rounded-[var(--radius-input)] text-muted-foreground transition-[color,background-color,transform] duration-short ease-hm-out hover:bg-muted hover:text-foreground active:translate-y-px"
          onClick={() => setShowNotifications(!showNotifications)}
          aria-label="通知"
          aria-expanded={showNotifications}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div className="fixed left-4 right-4 top-14 z-[var(--z-popover)] overflow-hidden rounded-[var(--radius-card)] border bg-popover text-popover-foreground shadow-popover sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
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
            {notifications.length > 0 && !isDemoMode && (
              <div className="border-t px-4 py-2">
                <Link
                  to="/approval/queue"
                  className="whitespace-nowrap text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setShowNotifications(false)}
                >
                  查看审批队列
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      {isDemoMode && (
        <Badge variant="outline" className="hidden border-info/30 bg-info/[0.055] text-info sm:inline-flex">
          本地演示
        </Badge>
      )}
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">{profile?.department || ''}</span>
    </header>
  )
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <TopHeader />
        <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8 xl:p-10">
          <Outlet />
        </main>
        <div className="select-none px-4 py-1 text-right text-[10px] text-muted-foreground/50">
          v{APP_VERSION}
        </div>
      </div>
    </SidebarProvider>
  )
}
