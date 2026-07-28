import { useState, useEffect, useCallback } from 'react'
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
import { getErrorMessage } from '@/lib/errors'
import type { Item, StockMovement, ApprovalRecord, BorrowRequest } from '@/types'
import { toast } from 'sonner'

const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export function Dashboard() {
  const { isApprover, user, profile, isDemoMode } = useAuth()
  const userId = user?.id
  const [statsLoading, setStatsLoading] = useState(true)
  const [overdueLoading, setOverdueLoading] = useState(true)
  const [movementsLoading, setMovementsLoading] = useState(true)
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [requestsLoading, setRequestsLoading] = useState(true)
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

  const loadDashboardData = useCallback(async () => {
    setStatsLoading(true)
    setOverdueLoading(true)
    setMovementsLoading(true)
    setApprovalsLoading(isApprover)
    setRequestsLoading(!!userId)

    const statsTask = itemsService.getStats()
      .then((summary) => {
        setStats(summary)
        setMonthlyRequests(summary.monthlyRequests)
      })
      .catch((error) => console.error('加载仪表盘统计失败:', error))
      .finally(() => setStatsLoading(false))

    const overdueTask = itemsService.getPage({ display_status: 'overdue', page_size: 5 })
      .then((result) => setOverdueItems(result.data))
      .catch((error) => console.error('加载逾期样机失败:', error))
      .finally(() => setOverdueLoading(false))

    const movementsTask = (async () => {
      try {
        if (import.meta.env.DEV && isDemoMode) {
          const { demoApi } = await import('@/lib/demo-mode')
          setRecentMovements(await demoApi.getMovements())
        } else {
          const { data, error } = await supabase
            .from('stock_movements')
            .select('id, item_id, movement_type, created_at, item:items(id, name, model), operator:profiles(id, display_name)')
            .order('created_at', { ascending: false })
            .limit(10)
          if (error) throw error
          setRecentMovements((data || []) as unknown as StockMovement[])
        }
      } catch (error) {
        console.error('加载库存变动失败:', error)
      } finally {
        setMovementsLoading(false)
      }
    })()

    const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin'
    const approvalsTask = isApprover && userId
      ? approvalService.getPendingApprovalsForDashboard(userId, isAdmin)
          .then(setPendingApprovals)
          .catch((error) => console.error('加载待审批失败:', error))
          .finally(() => setApprovalsLoading(false))
      : Promise.resolve().then(() => {
          setPendingApprovals([])
          setApprovalsLoading(false)
        })

    const requestsTask = userId
      ? (import.meta.env.DEV && isDemoMode
          ? import('@/lib/demo-mode').then(({ demoApi }) => demoApi.getRecentRequests())
          : borrowService.getRecentRequestsForDashboard(userId))
          .then(setMyRecentRequests)
          .catch((error) => console.error('加载最近申请失败:', error))
          .finally(() => setRequestsLoading(false))
      : Promise.resolve().then(() => {
          setMyRecentRequests([])
          setRequestsLoading(false)
        })

    await Promise.allSettled([statsTask, overdueTask, movementsTask, approvalsTask, requestsTask])
  }, [isApprover, isDemoMode, profile?.role, userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboardData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadDashboardData])

  // 快速审批 - 通过
  async function handleApprove(requestId: string) {
    setProcessingId(requestId)
    try {
      await approvalService.processApproval(requestId, 'approved')
      toast.success('审批通过')
      loadDashboardData()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
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
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
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

  return (
    <div className="hm-page space-y-10">
      <h1 className="hm-page-title">仪表盘</h1>

      {/* 统计卡片 - 可点击跳转 */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border bg-border shadow-card sm:grid-cols-2 xl:grid-cols-12">
        <Link to="/items?status=in_stock" className="hm-metric-link block bg-card xl:col-span-4">
          <Card className="h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
              <CardTitle className="text-sm font-medium">在库样机</CardTitle>
              <Package className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">{statsLoading ? <Spinner className="size-5" /> : stats.inStock}</div>
                  <p className="text-xs text-muted-foreground">{statsLoading ? '加载中...' : `共 ${stats.total} 台样机`}</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=borrowed" className="hm-metric-link block bg-card xl:col-span-3">
          <Card className="h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
              <CardTitle className="text-sm font-medium">借出中</CardTitle>
              <ArrowRightLeft className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">{statsLoading ? <Spinner className="size-5" /> : stats.borrowed}</div>
                  <p className="text-xs text-muted-foreground">当前借出数量</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=overdue" className="hm-metric-link block bg-card xl:col-span-2">
          <Card className="h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
              <CardTitle className="text-sm font-medium">逾期未还</CardTitle>
              <AlertTriangle className="size-4 text-destructive" />
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-3xl font-semibold tracking-[-0.03em] text-destructive tabular-nums">{statsLoading ? <Spinner className="size-5" /> : stats.overdue}</div>
                  <p className="text-xs text-muted-foreground">需要及时跟进</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/borrow/my-requests" className="hm-metric-link block bg-card xl:col-span-3">
          <Card className="h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
              <CardTitle className="text-sm font-medium">本月申请</CardTitle>
              <FileText className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">{statsLoading ? <Spinner className="size-5" /> : monthlyRequests}</div>
                  <p className="text-xs text-muted-foreground">本月借用申请数</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 快捷操作 */}
      <div className="hm-tool-rail flex flex-wrap gap-2 py-4">
        <Link to="/borrow/apply">
          <Button size="lg">
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* 逾期预警 */}
        {(overdueLoading || overdueItems.length > 0) && (
          <Card className="border-destructive/25 bg-destructive/[0.045]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" />
                逾期预警
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overdueLoading ? (
                <div className="flex justify-center py-6"><Spinner className="size-5" /></div>
              ) : <div className="space-y-3">
                {overdueItems.slice(0, 5).map(item => (
                  <div key={item.id} className="flex flex-col gap-3 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.model} | {item.barcode}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={ITEM_STATUS_MAP.overdue.color}>{ITEM_STATUS_MAP.overdue.label}</Badge>
                      <Link to={`/items/${item.id}`}>
                        <Button variant="outline" size="sm">查看</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>}
            </CardContent>
          </Card>
        )}

        {/* 状态分布 */}
        <Card>
          <CardHeader>
            <CardTitle>样机状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="flex h-[250px] items-center justify-center"><Spinner className="size-6" /></div>
            ) : pieData.length > 0 ? (
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* 待审批快速审批（审批人/管理员/超级管理员） */}
        {isApprover && (
          <Card className={pendingApprovals.length > 0 ? 'border-warning/30 bg-warning/[0.06]' : ''}>
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
              {approvalsLoading ? (
                <div className="flex justify-center py-6"><Spinner className="size-5" /></div>
              ) : pendingApprovals.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">暂无待审批申请</p>
              ) : (
                <div>
                  {pendingApprovals.slice(0, 5).map(record => {
                    const request = record.request
                    if (!request) return null
                    const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
                    const item = request.item || request.request_items?.[0]?.item
                    return (
                      <div key={record.id} className="space-y-2 border-t py-3 first:border-t-0">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{request.requester?.display_name || '-'}</div>
                          <Badge className={typeInfo?.color}>{typeInfo?.label}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {item?.name} ({item?.model})
                          <span className="mx-1">·</span>
                          {request.expected_borrow_date && new Date(request.expected_borrow_date).toLocaleDateString('zh-CN')}
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            className="bg-success text-success-foreground hover:bg-success/90"
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
            {movementsLoading ? (
              <div className="flex justify-center py-6"><Spinner className="size-5" /></div>
            ) : recentMovements.length > 0 ? (
                <div>
                  {recentMovements.map(movement => (
                  <div key={movement.id} className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{movement.item?.name || '-'}</p>
                      <p className="text-sm text-muted-foreground">
                        {movement.item?.model} | {movementTypeLabels[movement.movement_type] || movement.movement_type}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
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
      {(requestsLoading || myRecentRequests.length > 0) && (
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
            {requestsLoading ? (
              <div className="flex justify-center py-6"><Spinner className="size-5" /></div>
            ) : <div>
              {myRecentRequests.map(req => {
                const statusInfo = REQUEST_STATUS_MAP[req.status]
                const item = req.item || req.request_items?.[0]?.item
                return (
                  <div key={req.id} className="flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{item?.name || '-'}</p>
                      <p className="text-sm text-muted-foreground">
                        {req.request_number} | {new Date(req.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <Badge className={statusInfo?.color}>{statusInfo?.label || req.status}</Badge>
                  </div>
                )
              })}
            </div>}
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
