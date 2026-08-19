import { useState, useCallback } from 'react'
import { itemsService } from '@/services/items.service'
import { borrowReportService } from '@/services/borrow-report.service'
import { approvalService } from '@/services/approval.service'
import { exportService } from '@/services/export.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { ITEM_STATUS_MAP, REQUEST_STATUS_MAP, getBorrowTypeInfo } from '@/lib/constants'
import { getCurrentOverdueDays } from '@/lib/borrow-record'
import type { Item, BorrowRecord, ApprovalRecord } from '@/types'
import { Download, Search } from 'lucide-react'

type ReportType = 'items' | 'borrow_records' | 'approval_records'

const reportTypeOptions: { value: ReportType; label: string }[] = [
  { value: 'items', label: '样机清单' },
  { value: 'borrow_records', label: '借用记录' },
  { value: 'approval_records', label: '审批记录' },
]

const itemStatusOptions = Object.entries(ITEM_STATUS_MAP).map(([key, val]) => ({
  value: key,
  label: val.label,
}))

const borrowRecordStatusOptions = [
  { value: 'active', label: '借用中' },
  { value: 'returned', label: '已归还' },
  { value: 'overdue', label: '逾期' },
  { value: 'revoked', label: '已撤销' },
]

const approvalStatusOptions = Object.entries(REQUEST_STATUS_MAP).map(([key, val]) => ({
  value: key,
  label: val.label,
}))

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('items')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [borrowRecords, setBorrowRecords] = useState<BorrowRecord[]>([])
  const [approvalRecords, setApprovalRecords] = useState<ApprovalRecord[]>([])

  const handlePreview = useCallback(async () => {
    setLoading(true)
    try {
      if (reportType === 'items') {
        const result = await itemsService.getAll({
          status: statusFilter ? (statusFilter as Item['status']) : undefined,
        })
        setItems(result.data.slice(0, 50))
      } else if (reportType === 'borrow_records') {
        const data = await borrowReportService.getBorrowRecords({
          status: statusFilter || undefined,
        })
        setBorrowRecords(data.slice(0, 50))
      } else {
        const [pending, processed] = await Promise.all([
          approvalService.getPendingApprovals(),
          approvalService.getProcessedApprovals(),
        ])
        let all = [...pending, ...processed]
        if (statusFilter) {
          all = all.filter(r => r.action === statusFilter)
        }
        setApprovalRecords(all.slice(0, 50))
      }
    } catch (err) {
      toast.error('获取报表数据失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [reportType, statusFilter])

  function handleExport() {
    try {
      if (reportType === 'items') {
        exportService.exportItemsToExcel(items)
      } else if (reportType === 'borrow_records') {
        exportService.exportBorrowRecordsToExcel(borrowRecords)
      } else {
        exportService.exportApprovalRecordsToExcel(approvalRecords)
      }
      toast.success('导出成功')
    } catch (err) {
      toast.error('导出失败')
      console.error(err)
    }
  }

  function getStatusOptions() {
    if (reportType === 'items') return itemStatusOptions
    if (reportType === 'borrow_records') return borrowRecordStatusOptions
    return approvalStatusOptions
  }

  function hasData() {
    if (reportType === 'items') return items.length > 0
    if (reportType === 'borrow_records') return borrowRecords.length > 0
    return approvalRecords.length > 0
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">报表与导出</h1>

      <Card>
        <CardHeader>
          <CardTitle>筛选条件</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">报表类型</label>
              <Select value={reportType} onValueChange={v => { setReportType(v as ReportType); setStatusFilter('') }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportTypeOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">开始日期</label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">结束日期</label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">状态筛选</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  {getStatusOptions().map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Button onClick={handlePreview} disabled={loading}>
              {loading ? <Spinner className="size-4 mr-2" /> : <Search className="size-4 mr-2" />}
              预览数据
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={!hasData()}>
              <Download className="size-4 mr-2" />
              导出 Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            数据预览
            {hasData() && <span className="text-sm font-normal text-muted-foreground ml-2">（最多显示 50 条）</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-6" />
              <span className="ml-2 text-muted-foreground">加载中...</span>
            </div>
          ) : !hasData() ? (
            <p className="text-center text-muted-foreground py-8">请选择筛选条件后点击预览数据</p>
          ) : reportType === 'items' ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>条码</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>型号</TableHead>
                    <TableHead>分类</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>存放位置</TableHead>
                    <TableHead>当前借用人</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.barcode}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.model}</TableCell>
                      <TableCell>{item.category?.name || '-'}</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${ITEM_STATUS_MAP[item.status]?.color || ''}`}>
                          {ITEM_STATUS_MAP[item.status]?.label || item.status}
                        </span>
                      </TableCell>
                      <TableCell>{item.location || '-'}</TableCell>
                      <TableCell>{item.current_borrower?.display_name || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : reportType === 'borrow_records' ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>借用人</TableHead>
                    <TableHead>样机名称</TableHead>
                    <TableHead>样机型号</TableHead>
                    <TableHead>借用类型</TableHead>
                    <TableHead>借用日期</TableHead>
                    <TableHead>应还日期</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>逾期天数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {borrowRecords.map(record => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.borrower?.display_name || '-'}</TableCell>
                      <TableCell>{record.item?.name || '-'}</TableCell>
                      <TableCell>{record.item?.model || '-'}</TableCell>
                      <TableCell>{getBorrowTypeInfo(record.borrow_type).label}</TableCell>
                      <TableCell>{record.borrow_date}</TableCell>
                      <TableCell>{record.due_date}</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          record.status === 'active' ? 'bg-blue-100 text-blue-800' :
                          record.status === 'returned' ? 'bg-green-100 text-green-800' :
                          record.status === 'revoked' ? 'bg-orange-100 text-orange-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {record.status === 'active'
                            ? '借用中'
                            : record.status === 'returned'
                              ? '已归还'
                              : record.status === 'revoked'
                                ? '已撤销'
                                : '逾期'}
                        </span>
                      </TableCell>
                      <TableCell>{getCurrentOverdueDays(record)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>审批人</TableHead>
                    <TableHead>申请编号</TableHead>
                    <TableHead>申请人</TableHead>
                    <TableHead>样机名称</TableHead>
                    <TableHead>审批步骤</TableHead>
                    <TableHead>审批动作</TableHead>
                    <TableHead>审批时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvalRecords.map(record => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.approver?.display_name || '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{record.request?.request_number || '-'}</TableCell>
                      <TableCell>{record.request?.requester?.display_name || '-'}</TableCell>
                      <TableCell>{record.request?.item?.name || '-'}</TableCell>
                      <TableCell>第{record.step_level}步</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          record.action === 'approved' ? 'bg-green-100 text-green-800' :
                          record.action === 'rejected' ? 'bg-red-100 text-red-800' :
                          record.action === 'cancelled' ? 'bg-gray-100 text-gray-600' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {record.action === 'approved' ? '同意' : record.action === 'rejected' ? '拒绝' : record.action === 'cancelled' ? '已取消' : '待审批'}
                        </span>
                      </TableCell>
                      <TableCell>{record.acted_at || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
