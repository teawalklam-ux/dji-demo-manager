/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileClock, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { borrowService } from '@/services/borrow.service'
import type { BorrowRequest } from '@/types'

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  'pending',
  'partially_approved',
  'approved',
  'borrowed',
  'partially_returned',
  'partially_transferred',
  'returned',
  'transferred',
  'overdue',
  'rejected',
  'cancelled',
  'renewal_requested',
  'revoked',
  'invalidated',
]

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN')
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function RequestStatusBadge({ request }: { request: BorrowRequest }) {
  const statusInfo = REQUEST_STATUS_MAP[request.status] || {
    label: request.status,
    color: 'bg-muted text-muted-foreground',
  }
  return <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
}

export function RequestHistoryPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<BorrowRequest[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const result = await borrowService.getRequestHistory({
        search,
        status,
        page,
        page_size: PAGE_SIZE,
      })
      setRequests(result.data)
      setCount(result.count)
    } catch (error: unknown) {
      console.error('[RequestHistoryPage] load error:', error)
      setRequests([])
      setCount(0)
      toast.error(getErrorMessage(error, '申请历史加载失败'))
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const handleStatusChange = (value: string) => {
    setPage(1)
    setStatus(value)
  }

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  return (
    <div className="hm-page space-y-6">
      <div className="hm-dashboard-heading sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="hm-page-title">申请历史</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            查看所有正在审批与已结束的借用申请，并进入详情核对审批记录和归还水印照片。
          </p>
        </div>
        <div className="font-mono text-sm text-muted-foreground tabular-nums">
          共 {count} 条申请
        </div>
      </div>

      <div className="hm-tool-rail flex flex-col gap-3 py-4 lg:flex-row lg:items-end">
        <form className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row" onSubmit={handleSearch}>
          <div className="min-w-0 flex-1">
            <label htmlFor="request-history-search" className="mb-1.5 block text-sm font-medium">
              搜索申请
            </label>
            <Input
              id="request-history-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="申请编号或借用用途"
              className="w-full"
            />
          </div>
          <Button type="submit" className="sm:self-end">
            <Search className="mr-2 size-4" />
            搜索
          </Button>
        </form>
        <div className="w-full lg:w-56">
          <label htmlFor="request-history-status" className="mb-1.5 block text-sm font-medium">
            申请状态
          </label>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger id="request-history-status" className="w-full">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {STATUS_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {REQUEST_STATUS_MAP[value]?.label || value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 rounded-[var(--radius-card)] border bg-card p-4" aria-label="正在加载申请历史">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex min-h-64 items-start gap-4 rounded-[var(--radius-card)] border bg-card p-6 sm:p-8">
          <span className="hm-empty-state__icon">
            <FileClock className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">没有符合条件的申请</h2>
            <p className="mt-1 text-sm text-muted-foreground">调整搜索内容或状态筛选后再试。</p>
            {(search || status !== 'all') && (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-xs">
          <div className="hidden overflow-x-auto lg:block">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead>申请编号</TableHead>
                  <TableHead>申请人</TableHead>
                  <TableHead>样机</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>借用区间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>申请时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => {
                  const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
                  return (
                    <TableRow key={request.id}>
                      <TableCell className="font-mono font-medium">{request.request_number}</TableCell>
                      <TableCell>
                        <div className="max-w-40">
                          <p className="truncate font-medium">{request.requester?.display_name || '-'}</p>
                          <p className="truncate text-xs text-muted-foreground">{request.requester?.department || '未填写部门'}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-48">
                          <p className="truncate">
                            {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
                          </p>
                          <p className="text-xs text-muted-foreground">{request.request_items?.length || 0} 台</p>
                        </div>
                      </TableCell>
                      <TableCell><Badge className={typeInfo.color}>{typeInfo.label}</Badge></TableCell>
                      <TableCell>
                        <span className="whitespace-nowrap">
                          {formatDate(request.expected_borrow_date)} – {formatDate(request.expected_return_date)}
                        </span>
                      </TableCell>
                      <TableCell><RequestStatusBadge request={request} /></TableCell>
                      <TableCell>{formatDateTime(request.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/admin/request-history/${request.id}`)}
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="divide-y lg:hidden">
            {requests.map((request) => {
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              return (
                <article key={request.id} className="space-y-4 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold">{request.request_number}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {request.requester?.display_name || '-'} · {request.requester?.department || '未填写部门'}
                      </p>
                    </div>
                    <RequestStatusBadge request={request} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground">样机</p>
                      <p className="mt-1">
                        {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">借用区间</p>
                      <p className="mt-1 tabular-nums">
                        {formatDate(request.expected_borrow_date)} – {formatDate(request.expected_return_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/admin/request-history/${request.id}`)}
                    >
                      查看详情
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {count > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground tabular-nums">
            第 {page} / {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="mr-1 size-4" />
              上一页
            </Button>
            <Button
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              下一页
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
