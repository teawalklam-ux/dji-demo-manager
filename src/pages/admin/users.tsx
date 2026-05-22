import { useState, useEffect, useCallback } from 'react'
import { usersService } from '@/services/users.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ROLE_MAP, USER_STATUS_MAP } from '@/lib/constants'
import type { UserRole, Profile, UserStatus } from '@/types'
import { UserPlus, KeyRound, Pencil, Check, X } from 'lucide-react'

type TabKey = 'pending_approval' | 'active' | 'disabled'

export function UsersPage() {
  const { profile: currentProfile } = useAuth()
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
      toast.success('重置密码邮件已发送')
    } catch (err) {
      toast.error('发送重置邮件失败')
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
    setEditForm({
      display_name: user.display_name,
      phone: user.phone || '',
      department: user.department || '',
      role: user.role,
    })
    setEditDialogOpen(true)
  }

  async function handleEditSave() {
    if (!editUser) return
    try {
      setEditLoading(true)
      await usersService.updateUser(editUser.id, {
        display_name: editForm.display_name,
        phone: editForm.phone || undefined,
        department: editForm.department || undefined,
        role: editForm.role,
      })
      setUsers(prev => prev.map(u => (u.id === editUser.id ? { ...u, ...editForm, phone: editForm.phone || null, department: editForm.department || null } : u)))
      toast.success('用户信息已更新')
      setEditDialogOpen(false)
    } catch (err) {
      toast.error('更新失败')
      console.error(err)
    } finally {
      setEditLoading(false)
    }
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
                    <SelectItem value="user">普通用户</SelectItem>
                    <SelectItem value="approver">审批人</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
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
                  {currentList.map(user => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.display_name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="hidden sm:table-cell">{user.phone || '-'}</TableCell>
                      <TableCell className="hidden sm:table-cell">{user.department || '-'}</TableCell>
                      <TableCell>
                        {currentProfile?.id === user.id ? (
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
                              <SelectItem value="user">普通用户</SelectItem>
                              <SelectItem value="approver">审批人</SelectItem>
                              <SelectItem value="admin">管理员</SelectItem>
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
                          {currentProfile?.id !== user.id && (
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResetPassword(user.email)}
                            title="重置密码"
                          >
                            <KeyRound className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
              <Select
                value={editForm.role}
                onValueChange={(v: UserRole) => setEditForm(prev => ({ ...prev, role: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="approver">审批人</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
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
