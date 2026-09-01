import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileClock,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { getErrorMessage } from '@/lib/errors'
import {
  APP_LOG_CATEGORIES,
  APP_LOG_LEVELS,
  appLogService,
  type AppLogCategory,
  type AppLogEntry,
  type AppLogFilters,
  type AppLogLevel,
} from '@/services/app-log.service'

const PAGE_SIZE = 30

const LEVEL_META: Record<AppLogLevel, { label: string; className: string; icon: typeof Info }> = {
  info: { label: '信息', className: 'border-info/20 bg-info/[0.07] text-info', icon: Info },
  warn: { label: '警告', className: 'border-warning/25 bg-warning/[0.08] text-warning', icon: AlertTriangle },
  error: { label: '错误', className: 'border-destructive/20 bg-destructive/[0.07] text-destructive', icon: CircleAlert },
}

const CATEGORY_LABELS: Record<AppLogCategory, string> = {
  navigation: '页面访问',
  ui: '界面交互',
  api: '接口调用',
  business: '业务操作',
  system: '系统运行',
}

function dateValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function initialDateFrom() {
  const date = new Date()
  date.setDate(date.getDate() - 6)
  return dateValue(date)
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function LevelBadge({ level }: { level: AppLogLevel }) {
  const meta = LEVEL_META[level]
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={meta.className}>
      <Icon className="mr-1 size-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  )
}

function LogDetail({ log, onClose }: { log: AppLogEntry | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(log)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
        {log && (
          <>
            <DialogHeader>
              <div className="mb-1 flex flex-wrap items-center gap-2 pr-8">
                <LevelBadge level={log.level} />
                <Badge variant="secondary">{CATEGORY_LABELS[log.category]}</Badge>
              </div>
              <DialogTitle className="font-mono text-base">{log.event}</DialogTitle>
              <DialogDescription>
                {formatDateTime(log.created_at)} · {log.actor?.display_name || '账号已删除'}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-4 border-y py-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">页面</dt>
                <dd className="mt-1 break-all font-mono">{log.route || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">关联 ID</dt>
                <dd className="mt-1 break-all font-mono text-xs">{log.correlation_id}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">消息</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">{log.message || '-'}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">受控诊断上下文</p>
              <pre className="max-h-72 overflow-auto rounded-[var(--radius-input)] bg-muted p-4 text-xs leading-5">
                {Object.keys(log.context || {}).length > 0
                  ? JSON.stringify(log.context, null, 2)
                  : '无附加上下文'}
              </pre>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SystemLogsPage() {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState<AppLogEntry | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [levelInput, setLevelInput] = useState<AppLogLevel | 'all'>('all')
  const [categoryInput, setCategoryInput] = useState<AppLogCategory | 'all'>('all')
  const [dateFromInput, setDateFromInput] = useState(initialDateFrom)
  const [dateToInput, setDateToInput] = useState(() => dateValue(new Date()))
  const [filters, setFilters] = useState<AppLogFilters>(() => ({
    search: '',
    level: 'all',
    category: 'all',
    dateFrom: initialDateFrom(),
    dateTo: dateValue(new Date()),
  }))

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const result = await appLogService.list({ ...filters, page, pageSize: PAGE_SIZE })
      setLogs(result.data)
      setCount(result.count)
    } catch (error: unknown) {
      console.error('[SystemLogsPage] load error:', error)
      setLogs([])
      setCount(0)
      toast.error(getErrorMessage(error, '系统日志加载失败'))
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (dateFromInput && dateToInput && dateFromInput > dateToInput) {
      toast.error('开始日期不能晚于结束日期')
      return
    }
    setPage(1)
    setFilters({
      search: searchInput.trim(),
      level: levelInput,
      category: categoryInput,
      dateFrom: dateFromInput,
      dateTo: dateToInput,
    })
  }

  const clearFilters = () => {
    const from = initialDateFrom()
    const to = dateValue(new Date())
    setSearchInput('')
    setLevelInput('all')
    setCategoryInput('all')
    setDateFromInput(from)
    setDateToInput(to)
    setPage(1)
    setFilters({ search: '', level: 'all', category: 'all', dateFrom: from, dateTo: to })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const exportedCount = await appLogService.export(filters)
      if (exportedCount === 0) {
        toast.info('当前筛选条件下没有可导出的日志')
      } else {
        toast.success(`已导出 ${exportedCount} 条日志${exportedCount === 1000 ? '（已达单次上限）' : ''}`)
      }
    } catch (error: unknown) {
      console.error('[SystemLogsPage] export error:', error)
      toast.error(getErrorMessage(error, '系统日志导出失败'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="hm-page space-y-6">
      <div className="hm-dashboard-heading sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary">
            <ShieldCheck className="size-4" aria-hidden="true" />
            管理员可见 · 只读日志台
          </div>
          <h1 className="hm-page-title">系统日志</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            汇总 Web 页面访问与客户端异常，便于按时间、等级和事件定位问题。敏感字段会在写入前移除；审批记录和库存变动仍以各自审计数据为准。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            容量策略：最多保留 30 天或 50,000 条，以先到者为准。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 font-mono text-sm text-muted-foreground tabular-nums">共 {count} 条</div>
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting || loading}>
            <Download className="mr-2 size-4" />
            {exporting ? '导出中' : '导出 CSV'}
          </Button>
        </div>
      </div>

      <form className="hm-tool-rail grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_10rem_10rem_10.5rem_10.5rem_auto]" onSubmit={applyFilters}>
        <div>
          <label htmlFor="system-log-search" className="mb-1.5 block text-sm font-medium">事件或消息</label>
          <Input
            id="system-log-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="例如 window_error"
          />
        </div>
        <div>
          <label htmlFor="system-log-level" className="mb-1.5 block text-sm font-medium">等级</label>
          <Select value={levelInput} onValueChange={(value) => setLevelInput(value as AppLogLevel | 'all')}>
            <SelectTrigger id="system-log-level"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部等级</SelectItem>
              {APP_LOG_LEVELS.map((level) => <SelectItem key={level} value={level}>{LEVEL_META[level].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="system-log-category" className="mb-1.5 block text-sm font-medium">分类</label>
          <Select value={categoryInput} onValueChange={(value) => setCategoryInput(value as AppLogCategory | 'all')}>
            <SelectTrigger id="system-log-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {APP_LOG_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="system-log-from" className="mb-1.5 block text-sm font-medium">开始日期</label>
          <Input id="system-log-from" type="date" value={dateFromInput} onChange={(event) => setDateFromInput(event.target.value)} />
        </div>
        <div>
          <label htmlFor="system-log-to" className="mb-1.5 block text-sm font-medium">结束日期</label>
          <Input id="system-log-to" type="date" value={dateToInput} onChange={(event) => setDateToInput(event.target.value)} />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
          <Button type="submit" className="flex-1 xl:flex-none"><Search className="mr-2 size-4" />筛选</Button>
          <Button type="button" variant="ghost" onClick={clearFilters}>重置</Button>
        </div>
      </form>

      {loading ? (
        <div className="space-y-2 rounded-[var(--radius-card)] border bg-card p-4" aria-label="正在加载系统日志">
          {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="hm-empty-state rounded-[var(--radius-card)] border bg-card px-6">
          <span className="hm-empty-state__icon"><FileClock className="size-5" /></span>
          <div>
            <h2 className="font-semibold">没有符合条件的日志</h2>
            <p className="mt-1 text-sm text-muted-foreground">调整时间范围或筛选条件后再试。</p>
            <Button variant="outline" className="mt-4" onClick={clearFilters}>恢复近 7 天</Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-xs">
          <div className="hidden overflow-x-auto lg:block">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">时间</TableHead>
                  <TableHead className="w-24">等级</TableHead>
                  <TableHead className="w-28">分类</TableHead>
                  <TableHead>事件 / 消息</TableHead>
                  <TableHead className="w-44">用户</TableHead>
                  <TableHead className="w-52">页面</TableHead>
                  <TableHead className="w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{formatDateTime(log.created_at)}</TableCell>
                    <TableCell><LevelBadge level={log.level} /></TableCell>
                    <TableCell>{CATEGORY_LABELS[log.category]}</TableCell>
                    <TableCell>
                      <p className="font-mono text-xs font-medium">{log.event}</p>
                      <p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">{log.message || '—'}</p>
                    </TableCell>
                    <TableCell>
                      <p className="truncate text-sm font-medium">{log.actor?.display_name || '账号已删除'}</p>
                      <p className="truncate text-xs text-muted-foreground">{log.actor?.department || '未填写部门'}</p>
                    </TableCell>
                    <TableCell className="max-w-52 truncate font-mono text-xs text-muted-foreground">{log.route || '-'}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setSelectedLog(log)}>详情</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="divide-y lg:hidden">
            {logs.map((log) => (
              <button key={log.id} type="button" className="block w-full p-4 text-left transition-colors hover:bg-muted/40" onClick={() => setSelectedLog(log)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2"><LevelBadge level={log.level} /><Badge variant="secondary">{CATEGORY_LABELS[log.category]}</Badge></div>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatDateTime(log.created_at)}</span>
                </div>
                <p className="mt-3 font-mono text-xs font-medium">{log.event}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{log.message || '无消息'}</p>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{log.actor?.display_name || '账号已删除'}</span>
                  <span className="truncate font-mono">{log.route || '-'}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {count > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">第 {page} / {totalPages} 页 · 每页 {PAGE_SIZE} 条</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="mr-1 size-4" />上一页</Button>
            <Button variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页<ChevronRight className="ml-1 size-4" /></Button>
          </div>
        </div>
      )}

      <LogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  )
}
