import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { approvalService } from '@/services/approval.service'
import { borrowService } from '@/services/borrow.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  CircleCheckBig, History, ChartPie, type LucideIcon,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { ITEM_STATUS_MAP, BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import type { Item, StockMovement, ApprovalRecord, BorrowRequest } from '@/types'
import { toast } from 'sonner'

const STATUS_CHART_COLORS = {
  in_stock: 'var(--color-chart-in-stock)',
  reserved: 'var(--color-chart-reserved)',
  borrowed: 'var(--color-chart-borrowed)',
  overdue: 'var(--color-chart-overdue)',
  maintenance: 'var(--color-chart-maintenance)',
  retired: 'var(--color-chart-retired)',
} as const

function DashboardEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="hm-empty-state">
      <span className="hm-empty-state__icon" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}

export function Dashboard() {
  const { isApprover, user, profile, isDemoMode } = useAuth()
  const userId = user?.id
  const [statsLoading, setStatsLoading] = useState(true)
  const [overdueLoading, setOverdueLoading] = useState(true)
  const [movementsLoading, setMovementsLoading] = useState(true)
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [requestsLoading, setRequestsLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, inStock: 0, reserved: 0, borrowed: 0, overdue: 0, maintenance: 0, retired: 0 })
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
    { status: 'in_stock', name: '可用在库', value: stats.inStock },
    { status: 'reserved', name: '预定', value: stats.reserved },
    { status: 'borrowed', name: '借出', value: stats.borrowed },
    { status: 'overdue', name: '逾期', value: stats.overdue },
    { status: 'maintenance', name: '维修中', value: stats.maintenance },
    { status: 'retired', name: '已退役', value: stats.retired },
  ].filter(d => d.value > 0)

  const movementTypeLabels: Record<string, string> = {
    borrow_out: '借出',
    return_in: '归还',
    new_entry: '入库',
    maintenance: '维修',
    retire: '退役',
  }

  return (
    <div className="hm-page hm-dashboard space-y-8 sm:space-y-10">
      <section className="hm-dashboard-heading">
        <div className="min-w-0">
          <h1 className="hm-page-title">仪表盘</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            集中查看样机库存、借用申请与待办审批。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="lg">
            <Link to="/borrow/apply">
              <FileText className="size-4" />
              申请借用
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/borrow/my-requests">
              <ClipboardList className="size-4" />
              我的申请
            </Link>
          </Button>
          {isApprover && (
            <Button asChild variant="outline" size="lg">
              <Link to="/approval/queue">
                <CheckSquare className="size-4" />
                审批队列
                {pendingApprovals.length > 0 && (
                  <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs">
                    {pendingApprovals.length}
                  </Badge>
                )}
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* 统计带：保留原有查询和跳转，仅重新建立数值层级。 */}
      <section aria-label="样机运营指标" className="hm-metric-grid">
        <Link to="/items?status=in_stock" className="hm-metric-link bg-card xl:col-span-4">
          <Card className="hm-metric-card h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm font-medium text-muted-foreground">可用在库</CardTitle>
              <Package className="size-4 text-primary" />
            </CardHeader>
            <CardContent className="flex items-end justify-between px-5 pb-5 pt-7 sm:px-6 sm:pb-6">
              <div>
                <div className="hm-metric-value" aria-live="polite">{statsLoading ? <Spinner className="size-5" /> : stats.inStock}</div>
                <p className="mt-2 text-xs text-muted-foreground">{statsLoading ? '加载中…' : `全部样机 ${stats.total} 台`}</p>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=borrowed" className="hm-metric-link bg-card xl:col-span-3">
          <Card className="hm-metric-card h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm font-medium text-muted-foreground">借出中</CardTitle>
              <ArrowRightLeft className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="flex items-end justify-between px-5 pb-5 pt-7 sm:px-6 sm:pb-6">
              <div>
                <div className="hm-metric-value" aria-live="polite">{statsLoading ? <Spinner className="size-5" /> : stats.borrowed}</div>
                <p className="mt-2 text-xs text-muted-foreground">当前借出数量</p>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/items?status=overdue" className="hm-metric-link bg-card xl:col-span-2">
          <Card className="hm-metric-card h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm font-medium text-muted-foreground">逾期未还</CardTitle>
              <AlertTriangle className="size-4 text-destructive" />
            </CardHeader>
            <CardContent className="flex items-end justify-between px-5 pb-5 pt-7 sm:px-6 sm:pb-6">
              <div>
                <div className="hm-metric-value text-destructive" aria-live="polite">{statsLoading ? <Spinner className="size-5" /> : stats.overdue}</div>
                <p className="mt-2 text-xs text-muted-foreground">需要及时跟进</p>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link to="/borrow/my-requests" className="hm-metric-link bg-card xl:col-span-3">
          <Card className="hm-metric-card h-full rounded-none border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
              <CardTitle className="text-sm font-medium text-muted-foreground">本月申请</CardTitle>
              <FileText className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="flex items-end justify-between px-5 pb-5 pt-7 sm:px-6 sm:pb-6">
              <div>
                <div className="hm-metric-value" aria-live="polite">{statsLoading ? <Spinner className="size-5" /> : monthlyRequests}</div>
                <p className="mt-2 text-xs text-muted-foreground">本月借用申请数</p>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="hm-dashboard-panel xl:col-span-7">
          <CardHeader className="border-b pb-4">
            <div className="flex items-start gap-3">
              <span className="hm-panel-icon"><ChartPie className="size-4" /></span>
              <div>
                <CardTitle>样机状态分布</CardTitle>
                <CardDescription className="mt-1">全部样机当前所处状态</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-6">
            {statsLoading ? (
              <div className="flex h-[17.5rem] items-center justify-center"><Spinner className="size-6" /></div>
            ) : pieData.length > 0 ? (
              <div
                className="relative h-[17.5rem] min-w-0"
                role="img"
                aria-label={`样机状态分布：全部 ${stats.total} 台`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      innerRadius={68}
                      outerRadius={96}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="var(--color-paper)"
                      strokeWidth={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_CHART_COLORS[entry.status as keyof typeof STATUS_CHART_COLORS]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="hm-chart-center" aria-hidden="true">
                  <span className="font-display text-3xl font-semibold tabular-nums">{stats.total}</span>
                  <span className="text-xs text-muted-foreground">全部样机</span>
                </div>
              </div>
            ) : (
              <DashboardEmptyState
                icon={Package}
                title="暂无样机数据"
                description="样机入库后，这里会展示实时库存状态分布。"
                action={<Button asChild variant="outline" size="sm"><Link to="/items">查看样机列表</Link></Button>}
              />
            )}
          </CardContent>
        </Card>

        <Card className="hm-dashboard-panel xl:col-span-5">
          <CardHeader className="border-b pb-4">
            <div className="flex items-start gap-3">
              <span className="hm-panel-icon hm-panel-icon--danger"><AlertTriangle className="size-4" /></span>
              <div>
                <CardTitle>逾期跟进</CardTitle>
                <CardDescription className="mt-1">优先处理未按计划归还的样机</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {overdueLoading ? (
              <div className="flex justify-center py-12"><Spinner className="size-5" /></div>
            ) : overdueItems.length > 0 ? (
              <div>
                {overdueItems.slice(0, 5).map(item => (
                  <div key={item.id} className="hm-list-row">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{item.model} · {item.barcode}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={ITEM_STATUS_MAP.overdue.color}>{ITEM_STATUS_MAP.overdue.label}</Badge>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/items/${item.id}`}>查看</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmptyState
                icon={CircleCheckBig}
                title="目前没有逾期样机"
                description="所有借出样机都在计划归还时间内。"
                action={<Button asChild variant="outline" size="sm"><Link to="/items">查看全部样机</Link></Button>}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* 待审批快速审批（审批人/管理员/超级管理员） */}
        {isApprover && (
          <Card className="hm-dashboard-panel xl:col-span-5">
            <CardHeader className="border-b pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="hm-panel-icon"><CheckSquare className="size-4" /></span>
                  <div>
                    <CardTitle>待审批</CardTitle>
                    <CardDescription className="mt-1">需要你处理的借用申请</CardDescription>
                  </div>
                </div>
                {pendingApprovals.length > 0 && <Badge variant="destructive">{pendingApprovals.length}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {approvalsLoading ? (
                <div className="flex justify-center py-12"><Spinner className="size-5" /></div>
              ) : pendingApprovals.length === 0 ? (
                <DashboardEmptyState
                  icon={CircleCheckBig}
                  title="没有待审批申请"
                  description="新的审批任务到达后会显示在这里。"
                  action={<Button asChild variant="outline" size="sm"><Link to="/approval/queue">查看审批队列</Link></Button>}
                />
              ) : (
                <div>
                  {pendingApprovals.slice(0, 5).map(record => {
                    const request = record.request
                    if (!request) return null
                    const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
                    const item = request.item || request.request_items?.[0]?.item
                    return (
                      <div key={record.id} className="space-y-3 border-t py-4 first:border-t-0">
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
                    <Link to="/approval/queue" className="mt-2 inline-flex whitespace-nowrap text-sm font-medium text-primary underline-offset-4 hover:underline">
                      查看全部 {pendingApprovals.length} 条待审批
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 最近库存变动 */}
        <Card className={`hm-dashboard-panel ${isApprover ? 'xl:col-span-7' : 'xl:col-span-12'}`}>
          <CardHeader className="border-b pb-4">
            <div className="flex items-start gap-3">
              <span className="hm-panel-icon"><History className="size-4" /></span>
              <div>
                <CardTitle>最近库存变动</CardTitle>
                <CardDescription className="mt-1">按发生时间倒序记录库存动作</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {movementsLoading ? (
              <div className="flex justify-center py-12"><Spinner className="size-5" /></div>
            ) : recentMovements.length > 0 ? (
                <div>
                  {recentMovements.map(movement => (
                  <div key={movement.id} className="hm-list-row">
                    <div className="min-w-0">
                      <p className="font-medium">{movement.item?.name || '-'}</p>
                      <p className="text-sm text-muted-foreground">
                        {movement.item?.model} | {movementTypeLabels[movement.movement_type] || movement.movement_type}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <Badge variant="outline">{movementTypeLabels[movement.movement_type] || movement.movement_type}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(movement.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmptyState
                icon={History}
                title="暂无库存变动"
                description="入库、借出、归还等记录会按时间显示在这里。"
                action={<Button asChild variant="outline" size="sm"><Link to="/items">查看样机列表</Link></Button>}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* 我的最近申请 */}
      <Card className="hm-dashboard-panel">
          <CardHeader className="flex flex-row items-start justify-between gap-4 border-b pb-4">
            <div className="flex items-start gap-3">
              <span className="hm-panel-icon"><ClipboardList className="size-4" /></span>
              <div>
                <CardTitle>我的最近申请</CardTitle>
                <CardDescription className="mt-1">跟进最近提交的借用流程</CardDescription>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/borrow/my-requests">
                查看全部 <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-2">
            {requestsLoading ? (
              <div className="flex justify-center py-12"><Spinner className="size-5" /></div>
            ) : myRecentRequests.length > 0 ? <div>
              {myRecentRequests.map(req => {
                const statusInfo = REQUEST_STATUS_MAP[req.status]
                const item = req.item || req.request_items?.[0]?.item
                return (
                  <div key={req.id} className="hm-list-row">
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
            </div> : (
              <DashboardEmptyState
                icon={ClipboardList}
                title="还没有借用申请"
                description="提交申请后，可在这里查看最近流程与当前状态。"
                action={<Button asChild size="sm"><Link to="/borrow/apply">申请借用</Link></Button>}
              />
            )}
          </CardContent>
        </Card>

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
