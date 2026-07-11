import { useState, useEffect, useCallback } from 'react'
import { approvalService } from '@/services/approval.service'
import { usersService } from '@/services/users.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ROLE_MAP, BORROW_TYPE_MAP } from '@/lib/constants'
import type { ApprovalChain, ApprovalStep, UserRole, Profile } from '@/types'
import { Plus, Trash2, X } from 'lucide-react'

interface StepForm {
  type: 'role' | 'person'
  role: UserRole
  user_id: string
  label: string
}

const emptyStep: StepForm = { type: 'role', role: 'approver', user_id: '', label: '' }

export function ApprovalChainsPage() {
  const [chains, setChains] = useState<ApprovalChain[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [chainName, setChainName] = useState('')
  const [borrowType, setBorrowType] = useState<string>('all')
  const [maxBorrowDays, setMaxBorrowDays] = useState<string>('')
  const [steps, setSteps] = useState<StepForm[]>([{ ...emptyStep }])
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [chainsData, profilesData] = await Promise.all([
        approvalService.getChains(),
        usersService.getAll(),
      ])
      setChains(chainsData)
      setProfiles(profilesData)
    } catch (err) {
      toast.error('获取数据失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  function openCreate() {
    setEditingId(null)
    setChainName('')
    setBorrowType('all')
    setMaxBorrowDays('')
    setSteps([{ ...emptyStep }])
    setDialogOpen(true)
  }

  function openEdit(chain: ApprovalChain) {
    setEditingId(chain.id)
    setChainName(chain.name)
    setBorrowType(chain.borrow_type)
    setMaxBorrowDays(chain.max_borrow_days ? String(chain.max_borrow_days) : '')
    setSteps(
      chain.steps.map(s => ({
        type: s.type,
        role: s.role || 'approver',
        user_id: s.user_id || '',
        label: s.label,
      }))
    )
    setDialogOpen(true)
  }

  function addStep() {
    setSteps(prev => [...prev, { ...emptyStep }])
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  function updateStep(index: number, field: keyof StepForm, value: string) {
    setSteps(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  async function handleSubmit() {
    if (!chainName) {
      toast.error('请填写审批链名称')
      return
    }
    if (steps.length === 0 || steps.some(s => !s.label)) {
      toast.error('请为每个步骤填写标签')
      return
    }
    if (steps.some(s => s.type === 'person' && !s.user_id)) {
      toast.error('请为人员类型步骤选择审批人')
      return
    }

    const chainSteps: ApprovalStep[] = steps.map((s, i) => ({
      level: i + 1,
      type: s.type,
      ...(s.type === 'role' ? { role: s.role as UserRole } : { user_id: s.user_id }),
      label: s.label,
    }))

    const maxDays = maxBorrowDays ? parseInt(maxBorrowDays, 10) : null

    try {
      setSubmitting(true)
      if (editingId) {
        await approvalService.updateChain(editingId, {
          name: chainName,
          borrow_type: borrowType,
          steps: chainSteps,
          max_borrow_days: maxDays,
        })
        toast.success('审批链已更新')
      } else {
        await approvalService.createChain({
          name: chainName,
          borrow_type: borrowType,
          steps: chainSteps,
          max_borrow_days: maxDays,
        })
        toast.success('审批链已创建')
      }
      setDialogOpen(false)
      fetchData()
    } catch (err) {
      toast.error(editingId ? '更新审批链失败' : '创建审批链失败')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await approvalService.deleteChain(id)
      toast.success('审批链已删除')
      setDeleteConfirmId(null)
      fetchData()
    } catch (err) {
      toast.error('删除审批链失败')
      console.error(err)
    }
  }

  function getStepsPreview(chain: ApprovalChain) {
    return chain.steps
      .map(s => {
        if (s.type === 'role') return `${s.label}(${ROLE_MAP[s.role!]?.label || s.role})`
        const person = profiles.find(p => p.id === s.user_id)
        return `${s.label}(${person?.display_name || '未知用户'})`
      })
      .join(' → ')
  }

  const borrowTypeOptions = [
    { value: 'all', label: '全部' },
    { value: 'customer', label: BORROW_TYPE_MAP.customer?.label || '客户试用' },
    { value: 'marketing', label: BORROW_TYPE_MAP.marketing?.label || '营销演示' },
  ]

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
        <h1 className="text-2xl font-bold">审批链配置</h1>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-2" />
          新建审批链
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>审批链列表</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>借用类型</TableHead>
                <TableHead>最大天数</TableHead>
                <TableHead>审批步骤</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chains.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    暂无审批链
                  </TableCell>
                </TableRow>
              ) : (
                chains.map(chain => (
                  <TableRow key={chain.id}>
                    <TableCell className="font-medium">{chain.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {chain.borrow_type === 'all'
                          ? '全部'
                          : BORROW_TYPE_MAP[chain.borrow_type as keyof typeof BORROW_TYPE_MAP]?.label || chain.borrow_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {chain.max_borrow_days ? `${chain.max_borrow_days} 天` : '不限'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{getStepsPreview(chain)}</TableCell>
                    <TableCell>
                      <Badge variant={chain.is_active ? 'default' : 'secondary'}>
                        {chain.is_active ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(chain)}>
                          编辑
                        </Button>
                        {deleteConfirmId === chain.id ? (
                          <div className="flex items-center gap-1">
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(chain.id)}>
                              确认
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
                              取消
                            </Button>
                          </div>
                        ) : (
                          <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmId(chain.id)}>
                            <Trash2 className="size-3.5 mr-1" />
                            删除
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑审批链' : '新建审批链'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">审批链名称 *</label>
              <Input
                placeholder="例如：客户试用审批链"
                value={chainName}
                onChange={e => setChainName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">借用类型</label>
              <Select value={borrowType} onValueChange={setBorrowType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {borrowTypeOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">最大借用天数（留空不限制）</label>
              <Input
                type="number"
                min="1"
                placeholder="例如：3"
                value={maxBorrowDays}
                onChange={e => setMaxBorrowDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">设置后，用户申请该类型借用时归还日期不能超过此天数</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">审批步骤</label>
                <Button variant="outline" size="sm" onClick={addStep}>
                  <Plus className="size-3.5 mr-1" />
                  添加步骤
                </Button>
              </div>
              {steps.map((step, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">第 {index + 1} 步</span>
                    {steps.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeStep(index)}>
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">步骤类型</label>
                      <Select
                        value={step.type}
                        onValueChange={v => updateStep(index, 'type', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="role">按角色</SelectItem>
                          <SelectItem value="person">指定人员</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {step.type === 'role' ? (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">角色</label>
                        <Select
                          value={step.role}
                          onValueChange={v => updateStep(index, 'role', v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="super_admin">超级管理员</SelectItem>
                            <SelectItem value="admin">管理员</SelectItem>
                            <SelectItem value="approver">审批人</SelectItem>
                            <SelectItem value="user">普通用户</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">审批人</label>
                        <Select
                          value={step.user_id}
                          onValueChange={v => updateStep(index, 'user_id', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择人员" />
                          </SelectTrigger>
                          <SelectContent>
                            {profiles
                              .filter(p => p.status === 'active')
                              .map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.display_name} ({p.email})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">步骤标签</label>
                    <Input
                      placeholder="例如：部门主管审批"
                      value={step.label}
                      onChange={e => updateStep(index, 'label', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Spinner className="size-4 mr-2" />}
              {editingId ? '保存修改' : '创建审批链'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
