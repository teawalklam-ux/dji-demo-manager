import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { categoriesService } from '@/services/categories.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { ITEM_STATUS_MAP } from '@/lib/constants'
import { Plus, Download, ScanLine, Search, Printer, Upload, ArrowUpDown } from 'lucide-react'
import type { Item, Category, ItemStatus, ItemDisplayStatus } from '@/types'

type SortField = 'barcode' | 'name' | 'model' | 'category' | 'status' | 'location'
type SortOrder = 'asc' | 'desc'

const PAGE_SIZE = 50
const BatchBarcodePrint = lazy(() => import('@/components/barcode/barcode-print').then(module => ({ default: module.BatchBarcodePrint })))
const BarcodeScanner = lazy(() => import('@/components/barcode/barcode-scanner').then(module => ({ default: module.BarcodeScanner })))
const BatchImport = lazy(() => import('@/components/import/batch-import').then(module => ({ default: module.BatchImport })))

export function ItemsList() {
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [scanDialogOpen, setScanDialogOpen] = useState(false)

  // 批量打印相关状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)

  // 批量导入相关状态
  const [batchImportOpen, setBatchImportOpen] = useState(false)

  // 排序状态
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await itemsService.getPage({
        search: debouncedSearch || undefined,
        category_id: categoryFilter || undefined,
        display_status: statusFilter ? statusFilter as ItemDisplayStatus : undefined,
        page,
        page_size: PAGE_SIZE,
      })
      setItems(result.data)
      setTotalCount(result.count)
      setSelectedIds(new Set())
    } catch (error) {
      console.error('加载样机列表失败:', error)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, categoryFilter, page, statusFilter])

  useEffect(() => {
    loadCategories()
  }, [])

  // 搜索防抖：300ms 无输入后才触发查询
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setPage(1)
      setDebouncedSearch(search)
    }, 300)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [search])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  async function loadCategories() {
    try {
      const data = await categoriesService.getAll()
      setCategories(data)
    } catch (error) {
      console.error('加载分类失败:', error)
    }
  }

  async function handleExport() {
    try {
      const physicalStatus = statusFilter && statusFilter !== 'reserved'
        ? statusFilter as ItemStatus
        : undefined
      const [result, reservedItemIds, { exportService }] = await Promise.all([
        itemsService.getAll({
          search: debouncedSearch || undefined,
          category_id: categoryFilter || undefined,
          status: physicalStatus,
        }),
        itemsService.getReservedItemIds(),
        import('@/services/export.service'),
      ])
      const exportItems = result.data
        .map(item => ({
          ...item,
          display_status: item.status === 'in_stock' && reservedItemIds.has(item.id)
            ? 'reserved' as const
            : item.status,
        }))
        .filter(item => !statusFilter || item.display_status === statusFilter)
      exportService.exportItemsToExcel(exportItems)
    } catch (error) {
      console.error('导出失败:', error)
    }
  }

  // 勾选操作
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(i => i.id)))
    }
  }

  // 排序逻辑
  function handleSort(field: SortField) {
    if (sortField === field) {
      // 同一列: asc → desc → 取消
      if (sortOrder === 'asc') {
        setSortOrder('desc')
      } else {
        setSortField(null)
        setSortOrder('asc')
      }
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortedItems = useMemo(() => {
    if (!sortField) return items
    const sorted = [...items].sort((a, b) => {
      let valA: string = ''
      let valB: string = ''
      switch (sortField) {
        case 'barcode':
          valA = a.barcode || ''
          valB = b.barcode || ''
          break
        case 'name':
          valA = a.name || ''
          valB = b.name || ''
          break
        case 'model':
          valA = a.model || ''
          valB = b.model || ''
          break
        case 'category':
          valA = a.category?.name || ''
          valB = b.category?.name || ''
          break
        case 'status':
          valA = a.display_status || a.status || ''
          valB = b.display_status || b.status || ''
          break
        case 'location':
          valA = a.location || ''
          valB = b.location || ''
          break
      }
      const cmp = valA.localeCompare(valB, 'zh-CN')
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [items, sortField, sortOrder])

  function openBatchPrint() {
    if (selectedIds.size === 0) return
    setBatchPrintOpen(true)
  }

  // 可排序表头渲染
  function sortIndicator(field: SortField) {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 size-3 text-muted-foreground/40 inline-block" />
    }
    return (
      <span className={`ml-1 inline-block text-xs font-bold ${sortOrder === 'asc' ? 'text-primary' : 'text-warning'}`}>
        {sortOrder === 'asc' ? '↑' : '↓'}
      </span>
    )
  }

  return (
    <div className="hm-page space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
        <h1 className="hm-page-title">样机管理</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Link to="/items/new">
              <Button size="sm" className="sm:size-default">
                <Plus className="size-4" />
                <span className="hidden sm:inline ml-1">新增样机</span>
                <span className="sr-only sm:hidden">新增</span>
              </Button>
            </Link>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="sm:size-default"
              onClick={() => setBatchImportOpen(true)}
            >
              <Upload className="size-4" />
              <span className="hidden sm:inline ml-1">批量导入</span>
              <span className="sr-only sm:hidden">导入</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="sm:size-default"
            onClick={openBatchPrint}
            disabled={selectedIds.size === 0}
          >
            <Printer className="size-4" />
            <span className="hidden sm:inline ml-1">
              批量打印{selectedIds.size > 0 && ` (${selectedIds.size})`}
            </span>
            <span className="sr-only sm:hidden">打印</span>
          </Button>
          <Button variant="outline" size="sm" className="sm:size-default" onClick={handleExport}>
            <Download className="size-4" />
            <span className="hidden sm:inline ml-1">导出</span>
            <span className="sr-only sm:hidden">导出</span>
          </Button>
          <Button variant="outline" size="sm" className="sm:size-default" onClick={() => setScanDialogOpen(true)}>
            <ScanLine className="size-4" />
            <span className="hidden sm:inline ml-1">扫码</span>
            <span className="sr-only sm:hidden">扫码</span>
          </Button>
        </div>
      </div>

      {/* 搜索与筛选 */}
      <Card className="overflow-visible border-0 bg-transparent shadow-none">
        <CardContent className="hm-tool-rail px-0 py-4 sm:px-0 sm:pb-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索名称/型号/条码/SN码..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full"
              />
            </div>
            <div className="grid shrink-0 grid-cols-1 gap-2 sm:flex">
              <Select value={categoryFilter} onValueChange={(value) => {
                setPage(1)
                setCategoryFilter(value === 'all' ? '' : value)
              }}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="全部分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分类</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => {
                setPage(1)
                setStatusFilter(value === 'all' ? '' : value)
              }}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  {(Object.entries(ITEM_STATUS_MAP) as [ItemDisplayStatus, { label: string }][]).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 数据表格 */}
      <Card className="hm-data-surface">
        <CardHeader className="border-b">
          <CardTitle className="text-base tabular-nums">样机列表 (共 {totalCount} 条)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-6" />
            </div>
          ) : sortedItems.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无样机数据</p>
          ) : (
            <>
              {/* 桌面端表格 */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={sortedItems.length > 0 && selectedIds.size === sortedItems.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('barcode')}
                      >
                        条码{sortIndicator('barcode')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('name')}
                      >
                        名称{sortIndicator('name')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('model')}
                      >
                        型号{sortIndicator('model')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('category')}
                      >
                        分类{sortIndicator('category')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('status')}
                      >
                        状态{sortIndicator('status')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none whitespace-nowrap transition-[color,background-color] duration-micro ease-hm-out hover:text-foreground"
                        onClick={() => handleSort('location')}
                      >
                        存放位置{sortIndicator('location')}
                      </TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedItems.map(item => (
                      <TableRow key={item.id} className={selectedIds.has(item.id) ? 'bg-accent/50' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">{item.barcode}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.model}</TableCell>
                        <TableCell>{item.category?.name || '-'}</TableCell>
                        <TableCell>
                          <Badge className={ITEM_STATUS_MAP[item.display_status || item.status]?.color}>
                            {ITEM_STATUS_MAP[item.display_status || item.status]?.label || item.display_status || item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.location || '-'}</TableCell>
                        <TableCell>
                          <Link to={`/items/${item.id}`}>
                            <Button variant="ghost" size="sm">查看</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 移动端卡片 */}
              <div className="space-y-3 p-3 sm:hidden">
                {sortedItems.map(item => (
                  <div
                    key={item.id}
                    className={`rounded-[var(--radius-input)] border p-3 transition-[color,background-color,border-color] duration-micro ease-hm-out ${selectedIds.has(item.id) ? 'border-primary bg-accent/60' : 'bg-card'}`}
                    onClick={() => toggleSelect(item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-medium text-sm truncate">{item.name}</h3>
                          <Badge className={`${ITEM_STATUS_MAP[item.display_status || item.status]?.color} shrink-0 text-xs`}>
                            {ITEM_STATUS_MAP[item.display_status || item.status]?.label || item.display_status || item.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                          <div><span className="text-muted-foreground">型号:</span> {item.model || '-'}</div>
                          <div><span className="text-muted-foreground">分类:</span> {item.category?.name || '-'}</div>
                          <div className="col-span-2"><span className="text-muted-foreground">位置:</span> {item.location || '-'}</div>
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Link to={`/items/${item.id}`} onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">查看</Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {totalCount > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-4 sm:px-5">
                  <p className="text-sm text-muted-foreground">
                    第 {page} / {Math.ceil(totalCount / PAGE_SIZE)} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage(current => Math.max(current - 1, 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= Math.ceil(totalCount / PAGE_SIZE) || loading}
                      onClick={() => setPage(current => current + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 扫码对话框 */}
      {scanDialogOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner
            open={scanDialogOpen}
            onOpenChange={setScanDialogOpen}
            mode="barcode"
            onScan={(code) => {
              setScanDialogOpen(false)
              setSearch(code)
            }}
          />
        </Suspense>
      )}

      {/* 批量打印弹窗 */}
      {batchPrintOpen && (
        <Suspense fallback={null}>
          <BatchBarcodePrint
            items={items}
            selectedIds={Array.from(selectedIds)}
            onClose={() => setBatchPrintOpen(false)}
          />
        </Suspense>
      )}

      {/* 批量导入弹窗 */}
      {batchImportOpen && (
        <Suspense fallback={null}>
          <BatchImport
            open={batchImportOpen}
            onOpenChange={setBatchImportOpen}
            categories={categories}
            onSuccess={loadItems}
          />
        </Suspense>
      )}
    </div>
  )
}
