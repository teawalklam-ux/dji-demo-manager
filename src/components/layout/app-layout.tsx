import { Outlet, useLocation, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'
import { ROLE_MAP } from '@/lib/constants'

const mainNavItems = [
  { title: '仪表盘', href: '/', icon: LayoutDashboard },
  { title: '样机管理', href: '/items', icon: Package },
  { title: '借用申请', href: '/borrow/apply', icon: FileText },
  { title: '我的申请', href: '/borrow/my-requests', icon: CheckSquare },
  { title: '审批队列', href: '/approval/queue', icon: CheckSquare, roles: ['admin', 'approver'] },
  { title: '报表导出', href: '/reports', icon: BarChart3 },
]

const adminNavItems = [
  { title: '用户管理', href: '/admin/users', icon: Users },
  { title: '分类管理', href: '/admin/categories', icon: Tags },
  { title: '审批链配置', href: '/admin/approval-chains', icon: GitBranch },
  { title: '系统设置', href: '/admin/settings', icon: Settings },
]

function AppSidebar() {
  const { profile, signOut, isAdmin, isSuperAdmin } = useAuth()
  const location = useLocation()
  const isApprover = profile?.role === 'approver' || isAdmin

  const filteredMainNav = mainNavItems.filter(
    item => !item.roles || item.roles.some(r => isApprover && r === 'approver' || isAdmin && r === 'admin')
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

function TopHeader() {
  const { profile } = useAuth()

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4">
      <SidebarTrigger />
      <div className="flex-1" />
      <button className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <Bell className="h-5 w-5" />
      </button>
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
      </div>
    </SidebarProvider>
  )
}
