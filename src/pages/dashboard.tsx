import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Package, ArrowRightLeft, AlertTriangle, FileText } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { ITEM_STATUS_MAP } from '@/lib/constants'
import type { Item, StockMovement } from '@/types'

const CHART_COLORS = ['#2E6AB0', '#22C55E', '#EF4444', '#F97316', '#6B7280']

export function Dashboard() {
  const { isApprover } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, inStock: 0, borrowed: 0, overdue: 0 })
  const [overdueItems, setOverdueItems] = useState<Item[]>([])
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [monthlyRequests, setMonthlyRequests] = useState(0)

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    try {
      setLoading(true)
      const [statsResult, overdueResult, movementsResult, pendingResult, monthlyResult] = await Promise.allSettled([
        itemsService.getStats(),
        itemsService.getAll({ status: 'overdue' }),
        supabase.from('stock_movements').select('*, item:items(*, category:categories(*)), operator:profiles(*)').order('created_at', { ascending: false }).limit(10),
        isApprover
          ? supabase.from('borrow_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending')
          : Promise.resolve({ count: 0 }),
        supabase.from('borrow_requests').select('*', { count: 'exact', head: true }).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      ])

      if (statsResult.status === 'fulfilled') setStats(statsResult.value)
      if (overdueResult.status === 'fulfilled') setOverdueItems(overdueResult.value.data)
      if (movementsResult.status === 'fulfilled') setRecentMovements(movementsResult.value.data || [])
      if (pendingResult.status === 'fulfilled') setPendingCount(pendingResult.value.count || 0)
      if (monthlyResult.status === 'fulfilled') setMonthlyRequests(monthlyResult.value.count || 0)
    } catch (error) {
      console.error('加载仪表盘数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const pieData = [
    { name: '在库', value: stats.inStock },
    { name: '借出', value: stats.borrowed },
    { name: '逾期', value: stats.overdue },
    { name: '维修中', value: stats.total - stats.inStock - stats.borrowed - stats.overdue },
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

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">在库样机</CardTitle>
            <Package className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inStock}</div>
            <p className="text-xs text-muted-foreground">共 {stats.total} 台样机</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">借出中</CardTitle>
            <ArrowRightLeft className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.borrowed}</div>
            <p className="text-xs text-muted-foreground">当前借出数量</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">逾期未还</CardTitle>
            <AlertTriangle className="size-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
            <p className="text-xs text-muted-foreground">需要及时跟进</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">本月申请</CardTitle>
            <FileText className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{monthlyRequests}</div>
            <p className="text-xs text-muted-foreground">本月借用申请数</p>
          </CardContent>
        </Card>
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
                {overdueItems.map(item => (
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
        {/* 待审批提醒 */}
        {isApprover && pendingCount > 0 && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-700">
                <FileText className="size-5" />
                待审批提醒
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-yellow-800">
                当前有 <span className="font-bold text-lg">{pendingCount}</span> 条借用申请等待您审批
              </p>
              <Link to="/approval">
                <Button className="mt-3" variant="outline">前往审批</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* 最近活动 */}
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
    </div>
  )
}
