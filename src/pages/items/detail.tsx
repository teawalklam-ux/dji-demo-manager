import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ITEM_STATUS_MAP, BORROW_TYPE_MAP, BARCODE_GENERATE_OPTIONS } from '@/lib/constants'
import { ArrowLeft, Printer, Edit, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import JsBarcode from 'jsbarcode'
import type { Item, BorrowRecord, StockMovement } from '@/types'

export function ItemDetail() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<Item | null>(null)
  const [borrowRecords, setBorrowRecords] = useState<BorrowRecord[]>([])
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])
  const [error, setError] = useState<string | null>(null)

  const barcodeRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (id) loadData(id)
  }, [id])

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

  async function loadData(itemId: string) {
    try {
      setLoading(true)
      const [itemResult, recordsResult, movementsResult] = await Promise.allSettled([
        itemsService.getById(itemId),
        supabase
          .from('borrow_records')
          .select('*, borrower:profiles(*), request:borrow_requests(*)')
          .eq('item_id', itemId)
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
        setBorrowRecords(recordsResult.value.data || [])
      }
      if (movementsResult.status === 'fulfilled') {
        setStockMovements(movementsResult.value.data || [])
      }
    } catch (err) {
      setError('加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  const movementTypeLabels: Record<string, string> = {
    borrow_out: '借出',
    return_in: '归还',
    new_entry: '入库',
    maintenance: '维修',
    retire: '退役',
  }

  const recordStatusLabels: Record<string, { label: string; color: string }> = {
    active: { label: '借用中', color: 'bg-blue-100 text-blue-800' },
    returned: { label: '已归还', color: 'bg-green-100 text-green-800' },
    overdue: { label: '逾期', color: 'bg-red-100 text-red-800' },
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
          <Link to={`/borrow/apply/${item.id}`}>
            <Button>
              <FileText className="size-4" />
              申请借用
            </Button>
          </Link>
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
                    <TableCell>{record.borrower?.display_name || '-'}</TableCell>
                    <TableCell>
                      {record.borrow_type ? BORROW_TYPE_MAP[record.borrow_type as keyof typeof BORROW_TYPE_MAP]?.label || record.borrow_type : '-'}
                    </TableCell>
                    <TableCell>{record.borrow_date}</TableCell>
                    <TableCell>{record.due_date}</TableCell>
                    <TableCell>{record.return_date || '-'}</TableCell>
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
