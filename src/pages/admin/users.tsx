import { useState, useEffect, useCallback } from 'react'
import { usersService } from '@/services/users.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ROLE_MAP, USER_STATUS_MAP } from '@/lib/constants'
import type { UserRole, Profile, UserStatus } from '@/types'
import { UserPlus, KeyRound, Pencil, Check, X, Crown, AlertTriangle } from 'lucide-react'

type TabKey = 'pending_approval' | 'active' | 'disabled'

// 角色选项（不含 super_admin，super_admin 只能通过转移获得）
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'user', label: '普通用户' },
  { value: 'approver', label: '审批人' },
  { value: 'admin', label: '管理员' },
]

export function UsersPage() {
  const { profile: currentProfile, isSuperAdmin } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('pending_approval')

  // 邀请用户对话框
  const [dialogOpen, setDialogOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: '',
    display_name: '',
    role: 'user' as UserRole,
    password: '',
  })
  const [inviteLoading, setInviteLoading] = useState(false)

  // 编辑用户对话框
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', phone: '', department: '', role: 'user' as UserRole })
  const [editLoading, setEditLoading] = useState(false)

  // 转移超级管理员
  const [transferLoading, setTransferLoading] = useState(false)

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      const data = await usersService.getAll()
      setUsers(data)
    } catch (err) {
      toast.error('获取用户列表失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const pendingUsers = users.filter(u => u.status === 'pending_approval')
  const activeUsers = users.filter(u => u.status === 'active')
  const disabledUsers = users.filter(u => u.status === 'disabled')

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'pending_approval', label: '待审批', count: pendingUsers.length },
    { key: 'active', label: '已启用', count: activeUsers.length },
    { key: 'disabled', label: '已禁用', count: disabledUsers.length },
  ]

  const currentList = activeTab === 'pending_approval'
    ? pendingUsers
    : activeTab === 'active'
    ? activeUsers
    : disabledUsers

  async function handleRoleChange(userId: string, role: UserRole) {
    try {
      await usersService.updateRole(userId, role)
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, role } : u)))
      toast.success('角色已更新')
    } catch (err) {
      toast.error('更新角色失败')
      console.error(err)
    }
  }

  async function handleApprove(userId: string) {
    try {
      await usersService.approveUser(userId)
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, status: 'active' as UserStatus } : u)))
      toast.success('已审批通过')
    } catch (err) {
      toast.error('审批失败')
      console.error(err)
    }
  }

  async function handleReject(userId: string) {
    try {
      await usersService.rejectUser(userId)
      setUsers(prev => prev.filter(u => u.id !== userId))
      toast.success('已拒绝该用户')
    } catch (err) {
      toast.error('拒绝失败')
      console.error(err)
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: UserStatus) {
    try {
      const newStatus: UserStatus = currentStatus === 'active' ? 'disabled' : 'active'
      await usersService.updateStatus(userId, newStatus)
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, status: newStatus } : u)))
      toast.success(newStatus === 'active' ? '已启用用户' : '已禁用用户')
    } catch (err) {
      toast.error('操作失败')
      console.error(err)
    }
  }

  async function handleResetPassword(email: string) {
    try {
      await usersService.resetUserPassword(email)
      toast.success('重置密码邮件已发送，请通知用户查收邮箱')
    } catch (err: any) {
      const msg = err?.message || err?.toString() || '未知错误'
      if (msg.includes('rate limit') || msg.includes('429')) {
        toast.error('发送过于频繁，请稍后再试（Supabase 免费版每小时限3封）')
      } else if (msg.includes('not found') || msg.includes('no user')) {
        toast.error('该邮箱未注册，无法发送重置邮件')
      } else {
        toast.error(`发送重置邮件失败: ${msg}`)
      }
      console.error(err)
    }
  }

  async function handleInvite() {
    if (!inviteForm.email || !inviteForm.display_name || !inviteForm.password) {
      toast.error('请填写所有必填项')
      return
    }
    if (inviteForm.password.length < 6) {
      toast.error('密码至少6位')
      return
    }
    try {
      setInviteLoading(true)
      await usersService.inviteUser(inviteForm.email, inviteForm.display_name, inviteForm.role, inviteForm.password)
      toast.success('用户已创建')
      setDialogOpen(false)
      setInviteForm({ email: '', display_name: '', role: 'user', password: '' })
      fetchUsers()
    } catch (err) {
      toast.error('创建用户失败')
      console.error(err)
    } finally {
      setInviteLoading(false)
    }
  }

  function openEditDialog(user: Profile) {
    setEditUser(user)
    // super_admin 在编辑对话框中显示但不可修改角色
    setEditForm({
      display_name: user.display_name,
      phone: user.phone || '',
      department: user.department || '',
      role: user.role === 'super_admin' ? 'super_admin' : user.role,
    })
    setEditDialogOpen(true)
  }

  async function handleEditSave() {
    if (!editUser) return
    try {
      setEditLoading(true)
      // super_admin 不允许修改角色
      const updateData = editUser.role === 'super_admin'
        ? {
            display_name: editForm.display_name,
            phone: editForm.phone || undefined,
            department: editForm.department || undefined,
          }
        : {
            display_name: editForm.display_name,
            phone: editForm.phone || undefined,
            department: editForm.department || undefined,
            role: editForm.role,
          }
      await usersService.updateUser(editUser.id, updateData)
      setUsers(prev => prev.map(u => (u.id === editUser.id ? { ...u, ...updateData, phone: editForm.phone || null, department: editForm.department || null } : u)))
      toast.success('用户信息已更新')
      setEditDialogOpen(false)
    } catch (err) {
      toast.error('更新失败')
      console.error(err)
    } finally {
      setEditLoading(false)
    }
  }

  async function handleTransferSuperAdmin(newSuperAdminId: string) {
    try {
      setTransferLoading(true)
      await usersService.transferSuperAdmin(newSuperAdminId)
      toast.success('超级管理员权限已转移，您已成为普通管理员。页面即将刷新...')
      // 转移后当前用户角色变化，需要刷新页面重新加载
      setTimeout(() => {
        window.location.href = '/dji-demo-manager/'
      }, 2000)
    } catch (err: any) {
      toast.error(err?.message || '转移权限失败')
      console.error(err)
      setTransferLoading(false)
    }
  }

  // 判断用户是否为 super_admin
  function isSuperAdminUser(user: Profile) {
    return user.role === 'super_admin'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">用户管理</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="size-4 mr-2" />
              邀请用户
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>邀请新用户</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">邮箱 *</label>
                <Input
                  placeholder="user@example.com"
                  value={inviteForm.email}
                  onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">显示名称 *</label>
                <Input
                  placeholder="张三"
                  value={inviteForm.display_name}
                  onChange={e => setInviteForm(prev => ({ ...prev, display_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">角色</label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(v: UserRole) => setInviteForm(prev => ({ ...prev, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">初始密码 *</label>
                <Input
                  type="password"
                  placeholder="至少6位密码"
                  value={inviteForm.password}
                  onChange={e => setInviteForm(prev => ({ ...prev, password: e.target.value }))}
                />
              </div>
              <Button className="w-full" onClick={handleInvite} disabled={inviteLoading}>
                {inviteLoading && <Spinner className="size-4 mr-2" />}
                创建用户
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                tab.key === 'pending_approval' && tab.count > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-muted text-muted-foreground'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {activeTab === 'pending_approval' ? '待审批用户' : activeTab === 'active' ? '已启用用户' : '已禁用用户'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {currentList.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无数据</p>
          ) : activeTab === 'pending_approval' ? (
            /* 待审批列表 - 卡片式 */
            <div className="space-y-3">
              {pendingUsers.map(user => (
                <div key={user.id} className="border rounded-lg p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.display_name}</span>
                        <Badge className={USER_STATUS_MAP[user.status]?.color}>
                          {USER_STATUS_MAP[user.status]?.label}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                      <div className="text-xs text-muted-foreground">
                        注册时间: {new Date(user.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" onClick={() => handleApprove(user.id)}>
                        <Check className="size-3.5 mr-1" />
                        通过
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReject(user.id)}>
                        <X className="size-3.5 mr-1" />
                        拒绝
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 已启用/已禁用列表 - 表格式 */
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead className="hidden sm:table-cell">电话</TableHead>
                    <TableHead className="hidden sm:table-cell">部门</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentList.map(user => {
                    const isTargetSuperAdmin = isSuperAdminUser(user)
                    const isSelf = currentProfile?.id === user.id

                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {isTargetSuperAdmin && <Crown className="size-3.5 text-purple-600" />}
                            {user.display_name}
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell className="hidden sm:table-cell">{user.phone || '-'}</TableCell>
                        <TableCell className="hidden sm:table-cell">{user.department || '-'}</TableCell>
                        <TableCell>
                          {isSelf || isTargetSuperAdmin ? (
                            <Badge className={ROLE_MAP[user.role]?.color}>{ROLE_MAP[user.role]?.label}</Badge>
                          ) : (
                            <Select
                              value={user.role}
                              onValueChange={(v: UserRole) => handleRoleChange(user.id, v)}
                            >
                              <SelectTrigger className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={USER_STATUS_MAP[user.status]?.color}>
                            {USER_STATUS_MAP[user.status]?.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {/* 非 super_admin 且非自己：显示禁用/启用和编辑 */}
                            {!isTargetSuperAdmin && !isSelf && (
                              <>
                                <Button
                                  variant={user.status === 'active' ? 'destructive' : 'default'}
                                  size="sm"
                                  onClick={() => handleToggleStatus(user.id, user.status)}
                                >
                                  {user.status === 'active' ? '禁用' : '启用'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditDialog(user)}
                                  title="编辑"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </>
                            )}

                            {/* 重置密码：所有用户都可（super_admin 也可以重置自己密码） */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleResetPassword(user.email)}
                              title="重置密码"
                            >
                              <KeyRound className="size-3.5" />
                            </Button>

                            {/* 转移超级管理员权限：仅 super_admin 可见，且只能转给 admin */}
                            {isSuperAdmin && !isSelf && user.role === 'admin' && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    title="转移超级管理员权限"
                                    disabled={transferLoading}
                                  >
                                    <Crown className="size-3.5 text-purple-600" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle className="flex items-center gap-2">
                                      <AlertTriangle className="size-5 text-orange-500" />
                                      转移超级管理员权限
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      确定要将超级管理员权限转移给「{user.display_name}」吗？<br />
                                      转移后您将成为普通管理员，此操作不可撤销。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleTransferSuperAdmin(user.id)}
                                      className="bg-purple-600 text-white hover:bg-purple-700"
                                    >
                                      确认转移
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑用户对话框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">显示名称</label>
              <Input
                value={editForm.display_name}
                onChange={e => setEditForm(prev => ({ ...prev, display_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">电话</label>
              <Input
                placeholder="请输入电话"
                value={editForm.phone}
                onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">部门</label>
              <Input
                placeholder="请输入部门"
                value={editForm.department}
                onChange={e => setEditForm(prev => ({ ...prev, department: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">角色</label>
              {editUser?.role === 'super_admin' ? (
                <Badge className="bg-purple-100 text-purple-800">超级管理员（不可修改）</Badge>
              ) : (
                <Select
                  value={editForm.role}
                  onValueChange={(v: UserRole) => setEditForm(prev => ({ ...prev, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>取消</Button>
              <Button onClick={handleEditSave} disabled={editLoading}>
                {editLoading && <Spinner className="size-4 mr-2" />}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
