import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ITEM_STATUS_MAP, BARCODE_GENERATE_OPTIONS, getBorrowTypeInfo } from '@/lib/constants'
import { ArrowLeft, Printer, Edit, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import JsBarcode from 'jsbarcode'
import type { BorrowRecord, BorrowRequestItem, Item, StockMovement } from '@/types'
import { toast } from 'sonner'

type ItemBorrowHistoryRecord = {
  id: string
  borrowerName: string
  borrowType: string | null
  borrowDate: string
  dueDate: string
  returnDate: string | null
  status: 'reserved' | 'active' | 'returned' | 'transferred' | 'overdue' | 'revoked'
  createdAt: string
}

type ItemReservationLine = BorrowRequestItem & {
  request?: {
    requester?: {
      display_name?: string | null
    } | null
    borrow_type?: string | null
    expected_borrow_date?: string | null
    expected_return_date?: string | null
    created_at?: string | null
  } | null
}

export function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, isDemoMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<Item | null>(null)
  const [borrowRecords, setBorrowRecords] = useState<ItemBorrowHistoryRecord[]>([])
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])
  const [error, setError] = useState<string | null>(null)

  const barcodeRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (barcodeRef.current && item) {
      try {
        JsBarcode(barcodeRef.current, item.barcode, {
          ...BARCODE_GENERATE_OPTIONS,
        })
      } catch (err) {
        console.error('条码渲染失败:', err)
      }
    }
  }, [item])

  const loadData = useCallback(async (itemId: string) => {
    try {
      setLoading(true)
      if (import.meta.env.DEV && isDemoMode) {
        const { demoApi } = await import('@/lib/demo-mode')
        const detail = await demoApi.getItemDetail(itemId)
        setItem(detail.item)
        setBorrowRecords(mergeBorrowHistory(
          detail.borrowRecords,
          detail.reservationLines as ItemReservationLine[]
        ))
        setStockMovements(detail.stockMovements)
        return
      }

      const [itemResult, recordsResult, reservationLinesResult, movementsResult] = await Promise.allSettled([
        itemsService.getById(itemId),
        supabase
          .from('borrow_records')
          .select('*, borrower:profiles!borrow_records_borrower_id_fkey(*), request:borrow_requests(*)')
          .eq('item_id', itemId)
          .order('created_at', { ascending: false }),
        supabase
          .from('borrow_request_items')
          .select('*, request:borrow_requests(*, requester:profiles!borrow_requests_requester_id_fkey(*))')
          .eq('item_id', itemId)
          .in('status', ['reserved', 'borrowed'])
          .order('created_at', { ascending: false }),
        supabase
          .from('stock_movements')
          .select('*, operator:profiles(*)')
          .eq('item_id', itemId)
          .order('created_at', { ascending: false }),
      ])

      if (itemResult.status === 'fulfilled') {
        if (!itemResult.value) {
          setError('样机不存在')
        } else {
          setItem(itemResult.value)
        }
      } else {
        setError('加载样机信息失败')
      }

      if (recordsResult.status === 'fulfilled') {
        const records = (recordsResult.value.data || []) as BorrowRecord[]
        const reservationLines = reservationLinesResult.status === 'fulfilled'
          ? ((reservationLinesResult.value.data || []) as ItemReservationLine[])
          : []
        setBorrowRecords(mergeBorrowHistory(records, reservationLines))
      }
      if (movementsResult.status === 'fulfilled') {
        setStockMovements(movementsResult.value.data || [])
      }
    } catch {
      setError('加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [isDemoMode])

  useEffect(() => {
    if (id) void loadData(id)
  }, [id, loadData])

  function handlePrint() {
    window.print()
  }

  const movementTypeLabels: Record<string, string> = {
    borrow_out: '借出',
    return_in: '归还',
    new_entry: '入库',
    maintenance: '维修',
    retire: '退役',
    revoke: '审批撤销',
    transfer: '转借',
  }

  const recordStatusLabels: Record<string, { label: string; color: string }> = {
    reserved: { label: '预定', color: 'bg-violet-100 text-violet-800' },
    active: { label: '借用中', color: 'bg-blue-100 text-blue-800' },
    returned: { label: '已归还', color: 'bg-green-100 text-green-800' },
    transferred: { label: '已转借', color: 'bg-amber-100 text-amber-800' },
    overdue: { label: '逾期', color: 'bg-red-100 text-red-800' },
    revoked: { label: '已撤销', color: 'bg-orange-100 text-orange-800' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link to="/items">
          <Button variant="ghost">
            <ArrowLeft className="size-4" />
            返回列表
          </Button>
        </Link>
        <p className="text-center text-red-500 py-8">{error || '样机不存在'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/items">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{item.name}</h1>
          <Badge className={ITEM_STATUS_MAP[item.status]?.color}>
            {ITEM_STATUS_MAP[item.status]?.label || item.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {!isDemoMode && (['in_stock', 'borrowed', 'overdue'].includes(item.status) ? (
            <Link to={`/borrow/apply/${item.id}`}>
              <Button>
                <FileText className="size-4" />
                {item.status === 'in_stock' ? '申请借用' : '申请转借'}
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              onClick={() => toast.error(
                `该样机当前${ITEM_STATUS_MAP[item.status]?.label || item.status}，不能提交申请`
              )}
            >
              <FileText className="size-4" />
              申请借用
            </Button>
          ))}
          {isAdmin && (
            <Link to={`/items/${item.id}/edit`}>
              <Button variant="outline">
                <Edit className="size-4" />
                编辑
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">条码</dt>
                <dd className="font-mono mt-1">{item.barcode}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">产品名称</dt>
                <dd className="font-medium mt-1">{item.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">产品型号</dt>
                <dd className="mt-1">{item.model}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">序列号</dt>
                <dd className="mt-1">{item.serial_number || '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">分类</dt>
                <dd className="mt-1">{item.category?.name || '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">存放位置</dt>
                <dd className="mt-1">{item.location || '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">购买日期</dt>
                <dd className="mt-1">{item.purchase_date || '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">购买价格</dt>
                <dd className="mt-1">{item.purchase_price != null ? `¥${item.purchase_price.toLocaleString()}` : '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">当前借用人</dt>
                <dd className="mt-1">{item.current_borrower?.display_name || '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="mt-1">{new Date(item.created_at).toLocaleString('zh-CN')}</dd>
              </div>
              {item.notes && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">备注</dt>
                  <dd className="mt-1">{item.notes}</dd>
                </div>
              )}
            </dl>

            {/* 规格参数 */}
            {item.specs && Object.keys(item.specs).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="font-medium mb-2">规格参数</h4>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(item.specs).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="mt-0.5">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 条码区域 */}
        <Card className="print:shadow-none print:border-none">
          <CardHeader>
            <CardTitle>条码</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="rounded-md border p-4">
              <svg ref={barcodeRef} />
            </div>
            <Button variant="outline" onClick={handlePrint} className="print:hidden">
              <Printer className="size-4" />
              打印条码
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 借用记录 */}
      <Card>
        <CardHeader>
          <CardTitle>借用记录</CardTitle>
        </CardHeader>
        <CardContent>
          {borrowRecords.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">暂无借用记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>借用人</TableHead>
                  <TableHead>借用类型</TableHead>
                  <TableHead>借用日期</TableHead>
                  <TableHead>应还日期</TableHead>
                  <TableHead>归还日期</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borrowRecords.map(record => (
                  <TableRow key={record.id}>
                    <TableCell>{record.borrowerName}</TableCell>
                    <TableCell>
                      {record.borrowType ? getBorrowTypeInfo(record.borrowType).label : '-'}
                    </TableCell>
                    <TableCell>{record.borrowDate}</TableCell>
                    <TableCell>{record.dueDate}</TableCell>
                    <TableCell>{record.returnDate || '-'}</TableCell>
                    <TableCell>
                      <Badge className={recordStatusLabels[record.status]?.color}>
                        {recordStatusLabels[record.status]?.label || record.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 库存变动记录 */}
      <Card>
        <CardHeader>
          <CardTitle>库存变动记录</CardTitle>
        </CardHeader>
        <CardContent>
          {stockMovements.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">暂无变动记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>变动类型</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockMovements.map(movement => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {movementTypeLabels[movement.movement_type] || movement.movement_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{movement.operator?.display_name || '-'}</TableCell>
                    <TableCell>{movement.notes || '-'}</TableCell>
                    <TableCell>{new Date(movement.created_at).toLocaleString('zh-CN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function mergeBorrowHistory(
  records: BorrowRecord[],
  reservationLines: ItemReservationLine[]
): ItemBorrowHistoryRecord[] {
  const recordLineIds = new Set(records.map(record => record.request_item_id).filter(Boolean))

  const historyRecords: ItemBorrowHistoryRecord[] = records.map(record => ({
    id: record.id,
    borrowerName: record.borrower?.display_name || '-',
    borrowType: record.borrow_type,
    borrowDate: record.borrow_date,
    dueDate: record.due_date,
    returnDate: record.return_date,
    status: record.status,
    createdAt: record.created_at,
  }))

  const reservationRecords: ItemBorrowHistoryRecord[] = reservationLines
    .filter(line => line.status === 'reserved' || !recordLineIds.has(line.id))
    .map(line => ({
      id: `request-line-${line.id}`,
      borrowerName: line.request?.requester?.display_name || '-',
      borrowType: line.request?.borrow_type || null,
      borrowDate: line.actual_borrow_date || line.request?.expected_borrow_date || '-',
      dueDate: line.request?.expected_return_date || '-',
      returnDate: line.actual_return_date,
      status: line.status === 'reserved' ? 'reserved' : 'active',
      createdAt: line.request?.created_at || line.created_at,
    }))

  return [...historyRecords, ...reservationRecords].sort((a, b) => {
    const dateA = a.borrowDate === '-' ? a.createdAt : a.borrowDate
    const dateB = b.borrowDate === '-' ? b.createdAt : b.borrowDate
    return dateB.localeCompare(dateA)
  })
}
