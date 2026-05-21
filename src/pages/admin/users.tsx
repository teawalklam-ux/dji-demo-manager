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
import { ROLE_MAP } from '@/lib/constants'
import type { UserRole, Profile } from '@/types'
import { UserPlus } from 'lucide-react'

export function UsersPage() {
  const { profile: currentProfile } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: '',
    display_name: '',
    role: 'user' as UserRole,
    password: '',
  })
  const [inviteLoading, setInviteLoading] = useState(false)

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

  async function handleToggleActive(userId: string, isActive: boolean) {
    try {
      await usersService.toggleActive(userId, !isActive)
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, is_active: !isActive } : u)))
      toast.success(isActive ? '已禁用用户' : '已启用用户')
    } catch (err) {
      toast.error('操作失败')
      console.error(err)
    }
  }

  async function handleInvite() {
    if (!inviteForm.email || !inviteForm.display_name || !inviteForm.password) {
      toast.error('请填写所有必填项')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
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
                  placeholder="请输入密码"
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

      <Card>
        <CardHeader>
          <CardTitle>用户列表</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>电话</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    暂无用户
                  </TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.display_name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.phone || '-'}</TableCell>
                    <TableCell>{user.department || '-'}</TableCell>
                    <TableCell>
                      {currentProfile?.id === user.id ? (
                        <Badge className={ROLE_MAP[user.role].color}>{ROLE_MAP[user.role].label}</Badge>
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
                      <Badge variant={user.is_active ? 'default' : 'secondary'}>
                        {user.is_active ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {currentProfile?.id !== user.id && (
                        <Button
                          variant={user.is_active ? 'destructive' : 'default'}
                          size="sm"
                          onClick={() => handleToggleActive(user.id, user.is_active)}
                        >
                          {user.is_active ? '禁用' : '启用'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
