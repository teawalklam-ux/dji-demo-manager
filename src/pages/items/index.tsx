import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { categoriesService } from '@/services/categories.service'
import { exportService } from '@/services/export.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { BatchBarcodePrint } from '@/components/barcode/barcode-print'
import { BarcodeScanner } from '@/components/barcode/barcode-scanner'
import { ITEM_STATUS_MAP } from '@/lib/constants'
import { Plus, Download, ScanLine, Search, Printer } from 'lucide-react'
import type { Item, Category, ItemStatus } from '@/types'

export function ItemsList() {
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [totalCount, setTotalCount] = useState(0)
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

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await itemsService.getAll({
        search: debouncedSearch || undefined,
        category_id: categoryFilter || undefined,
        status: (statusFilter || undefined) as ItemStatus | undefined,
      })
      setItems(result.data)
      setTotalCount(result.count)
    } catch (error) {
      console.error('加载样机列表失败:', error)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, categoryFilter, statusFilter])

  useEffect(() => {
    loadCategories()
  }, [])

  // 搜索防抖：300ms 无输入后才触发查询
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
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

  function handleExport() {
    try {
      exportService.exportItemsToExcel(items)
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

  function openBatchPrint() {
    if (selectedIds.size === 0) return
    setBatchPrintOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">样机管理</h1>
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
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索名称/型号/条码/SN码..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[130px]">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  {(Object.entries(ITEM_STATUS_MAP) as [ItemStatus, { label: string }][]).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 数据表格 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">样机列表 (共 {totalCount} 条)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-6" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">暂无样机数据</p>
          ) : (
            <>
              {/* 桌面端表格 */}
              <div className="hidden sm:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={items.length > 0 && selectedIds.size === items.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>条码</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>型号</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>存放位置</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => (
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
                          <Badge className={ITEM_STATUS_MAP[item.status]?.color}>
                            {ITEM_STATUS_MAP[item.status]?.label || item.status}
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
              <div className="sm:hidden space-y-3">
                {items.map(item => (
                  <div
                    key={item.id}
                    className={`border rounded-lg p-3 ${selectedIds.has(item.id) ? 'bg-accent/50 border-primary' : 'bg-card'}`}
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
                          <Badge className={`${ITEM_STATUS_MAP[item.status]?.color} shrink-0 text-xs`}>
                            {ITEM_STATUS_MAP[item.status]?.label || item.status}
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
            </>
          )}
        </CardContent>
      </Card>

      {/* 扫码对话框 */}
      <BarcodeScanner
        open={scanDialogOpen}
        onOpenChange={setScanDialogOpen}
        onScan={(code) => {
          setScanDialogOpen(false)
          setSearch(code)
        }}
      />

      {/* 批量打印弹窗 */}
      {batchPrintOpen && (
        <BatchBarcodePrint
          items={items}
          selectedIds={Array.from(selectedIds)}
          onClose={() => setBatchPrintOpen(false)}
        />
      )}
    </div>
  )
}
