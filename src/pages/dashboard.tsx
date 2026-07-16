import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { approvalService } from '@/services/approval.service'
import { borrowService } from '@/services/borrow.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Package, ArrowRightLeft, AlertTriangle, FileText,
  CheckSquare, ClipboardList, ArrowRight, ChevronRight,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { ITEM_STATUS_MAP, BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import type { Item, StockMovement, ApprovalRecord, BorrowRequest } from '@/types'
import { toast } from 'sonner'

const CHART_COLORS = ['#2E6AB0', '#22C55E', '#EF4444', '#F97316', '#6B7280']

export function Dashboard() {
  const { isApprover } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, inStock: 0, reserved: 0, borrowed: 0, overdue: 0 })
  const [overdueItems, setOverdueItems] = useState<Item[]>([])
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([])
  const [monthlyRequests, setMonthlyRequests] = useState(0)
  const [myRecentRequests, setMyRecentRequests] = useState<BorrowRequest[]>([])

  // 快速审批状态
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    try {
      setLoading(true)
      const [statsResult, overdueResult, movementsResult, pendingResult, monthlyResult, myRequestsResult] = await Promise.allSettled([
        itemsService.getStats(),
        itemsService.getAll({ status: 'overdue' }),
        supabase.from('stock_movements').select('*, item:items(*, category:categories(*)), operator:profiles(*)').order('created_at', { ascending: false }).limit(10),
        isApprover
          ? approvalService.getPendingApprovals()
          : Promise.resolve([]),
        supabase.from('borrow_requests').select('*', { count: 'exact', head: true }).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        borrowService.getMyRequests(),
      ])

      if (statsResult.status === 'fulfilled') setStats(statsResult.value)
      if (overdueResult.status === 'fulfilled') setOverdueItems(overdueResult.value.data)
      if (movementsResult.status === 'fulfilled') setRecentMovements(movementsResult.value.data || [])
      if (pendingResult.status === 'fulfilled') setPendingApprovals(pendingResult.value)
      if (monthlyResult.status === 'fulfilled') setMonthlyRequests(monthlyResult.value.count || 0)
      if (myRequestsResult.status === 'fulfilled') setMyRecentRequests(myRequestsResult.value.slice(0, 5))
    } catch (error) {
      console.error('加载仪表盘数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 快速审批 - 通过
  async function handleApprove(requestId: string) {
    setProcessingId(requestId)
    try {
      await approvalService.processApproval(requestId, 'approved')
      toast.success('审批通过')
      loadDashboardData()
    } catch (error: any) {
      toast.error(error.message || '审批操作失败')
    } finally {
      setProcessingId(null)
    }
  }

  // 快速审批 - 拒绝
  async function handleReject(requestId: string) {
    if (!rejectReason.trim()) {
      toast.error('请填写拒绝原因')
      return
    }
    setProcessingId(requestId)
    try {
      await approvalService.processApproval(requestId, 'rejected', rejectReason.trim())
      toast.success('已拒绝申请')
      setRejectDialogOpen(null)
      setRejectReason('')
      loadDashboardData()
    } catch (error: any) {
      toast.error(error.message || '审批操作失败')
    } finally {
      setProcessingId(null)
    }
  }

  const pieData = [
    { name: '在库', value: stats.inStock },
    { name: '预定', value: stats.reserved },
    { name: '借出', value: stats.borrowed },
    { name: '逾期', value: stats.overdue },
    { name: '维修中', value: stats.total - stats.inStock - stats.reserved - stats.borrowed - stats.overdue },
  ].filter(d => d.value > 0)

  const movementTypeLabels: Record<string, string> = {
    borrow_out: '借出',
    return_in: '归还',
    new_entry: '入库',
    maintenance: '维修',
    retire: '退役',
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
      <h1 className="text-2xl font-bold">仪表盘</h1>

      {/* 统计卡片 - 可点击跳转 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/items?status=in_stock" className="block">
          <Card className="transition-shadow hover:shadow-md cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">在库样机</CardTitle>
              <Package className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{stats.inStock}</div>
                  <p className="text-xs text-muted-foreground">共 {stats.total} 台样机</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=borrowed" className="block">
          <Card className="transition-shadow hover:shadow-md cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">借出中</CardTitle>
              <ArrowRightLeft className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{stats.borrowed}</div>
                  <p className="text-xs text-muted-foreground">当前借出数量</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=overdue" className="block">
          <Card className="transition-shadow hover:shadow-md cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">逾期未还</CardTitle>
              <AlertTriangle className="size-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
                  <p className="text-xs text-muted-foreground">需要及时跟进</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/borrow/my-requests" className="block">
          <Card className="transition-shadow hover:shadow-md cursor-pointer h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">本月申请</CardTitle>
              <FileText className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{monthlyRequests}</div>
                  <p className="text-xs text-muted-foreground">本月借用申请数</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 快捷操作 */}
      <div className="flex flex-wrap gap-3">
        <Link to="/borrow/apply">
          <Button variant="outline" size="lg">
            <FileText className="size-4 mr-2" />
            申请借用
          </Button>
        </Link>
        <Link to="/borrow/my-requests">
          <Button variant="outline" size="lg">
            <ClipboardList className="size-4 mr-2" />
            我的申请
          </Button>
        </Link>
        {isApprover && (
          <Link to="/approval/queue">
            <Button variant="outline" size="lg">
              <CheckSquare className="size-4 mr-2" />
              审批队列
              {pendingApprovals.length > 0 && (
                <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-xs">
                  {pendingApprovals.length}
                </Badge>
              )}
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 逾期预警 */}
        {overdueItems.length > 0 && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="size-5" />
                逾期预警
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {overdueItems.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-md bg-white p-3 shadow-sm">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.model} | {item.barcode}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={ITEM_STATUS_MAP.overdue.color}>{ITEM_STATUS_MAP.overdue.label}</Badge>
                      <Link to={`/items/${item.id}`}>
                        <Button variant="outline" size="sm">查看</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 状态分布 */}
        <Card>
          <CardHeader>
            <CardTitle>样机状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">暂无数据</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 待审批快速审批（审批人/管理员/超级管理员） */}
        {isApprover && (
          <Card className={pendingApprovals.length > 0 ? 'border-yellow-200 bg-yellow-50' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="size-5" />
                待审批
                {pendingApprovals.length > 0 && (
                  <Badge variant="destructive" className="ml-1">{pendingApprovals.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingApprovals.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">暂无待审批申请</p>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.slice(0, 5).map(record => {
                    const request = record.request
                    if (!request) return null
                    const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
                    return (
                      <div key={record.id} className="rounded-md bg-white p-3 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{request.requester?.display_name || '-'}</div>
                          <Badge className={typeInfo?.color}>{typeInfo?.label}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {request.item?.name} ({request.item?.model})
                          <span className="mx-1">·</span>
                          {request.expected_borrow_date && new Date(request.expected_borrow_date).toLocaleDateString('zh-CN')}
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleApprove(request.id)}
                            disabled={processingId === request.id}
                          >
                            {processingId === request.id && <Spinner className="mr-1 size-3" />}
                            通过
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => { setRejectDialogOpen(record.id); setRejectReason('') }}
                            disabled={processingId === request.id}
                          >
                            拒绝
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  {pendingApprovals.length > 5 && (
                    <Link to="/approval/queue" className="block text-center text-sm text-primary hover:underline pt-1">
                      查看全部 {pendingApprovals.length} 条待审批 →
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 最近库存变动 */}
        <Card>
          <CardHeader>
            <CardTitle>最近库存变动</CardTitle>
          </CardHeader>
          <CardContent>
            {recentMovements.length > 0 ? (
              <div className="space-y-3">
                {recentMovements.map(movement => (
                  <div key={movement.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{movement.item?.name || '-'}</p>
                      <p className="text-sm text-muted-foreground">
                        {movement.item?.model} | {movementTypeLabels[movement.movement_type] || movement.movement_type}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{movementTypeLabels[movement.movement_type] || movement.movement_type}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(movement.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">暂无变动记录</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 我的最近申请 */}
      {myRecentRequests.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>我的最近申请</CardTitle>
            <Link to="/borrow/my-requests">
              <Button variant="ghost" size="sm">
                查看全部 <ArrowRight className="size-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {myRecentRequests.map(req => {
                const statusInfo = REQUEST_STATUS_MAP[req.status]
                return (
                  <div key={req.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{req.item?.name || '-'}</p>
                      <p className="text-sm text-muted-foreground">
                        {req.request_number} | {new Date(req.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <Badge className={statusInfo?.color}>{statusInfo?.label || req.status}</Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 拒绝审批弹窗 */}
      <Dialog
        open={!!rejectDialogOpen}
        onOpenChange={(open) => {
          if (!open) { setRejectDialogOpen(null); setRejectReason('') }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝申请</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rejectReason">拒绝原因 *</Label>
              <Textarea
                id="rejectReason"
                placeholder="请输入拒绝原因"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejectDialogOpen(null); setRejectReason('') }}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const record = pendingApprovals.find(r => r.id === rejectDialogOpen)
                  if (record?.request) handleReject(record.request.id)
                }}
                disabled={processingId !== null}
              >
                {processingId !== null && <Spinner className="mr-1 size-3" />}
                确认拒绝
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
