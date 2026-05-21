import { useState, useEffect, useCallback } from 'react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { BatchBarcodePrint } from '@/components/barcode/barcode-print'
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
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const [scanValue, setScanValue] = useState('')

  // 批量打印相关状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await itemsService.getAll({
        search: search || undefined,
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
  }, [search, categoryFilter, statusFilter])

  useEffect(() => {
    loadCategories()
  }, [])

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

  function handleScanSearch() {
    if (scanValue.trim()) {
      setSearch(scanValue.trim())
      setScanDialogOpen(false)
      setScanValue('')
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">样机管理</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link to="/items/new">
              <Button>
                <Plus className="size-4" />
                新增样机
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            onClick={openBatchPrint}
            disabled={selectedIds.size === 0}
          >
            <Printer className="size-4" />
            批量打印
            {selectedIds.size > 0 && ` (${selectedIds.size})`}
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="size-4" />
            导出Excel
          </Button>
          <Button variant="outline" onClick={() => setScanDialogOpen(true)}>
            <ScanLine className="size-4" />
            扫码查询
          </Button>
        </div>
      </div>

      {/* 搜索与筛选 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索名称/型号/条码..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
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
              <SelectTrigger className="w-[150px]">
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
          )}
        </CardContent>
      </Card>

      {/* 扫码对话框 */}
      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>扫码查询</DialogTitle>
            <DialogDescription>扫描或输入条码进行查询</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="请扫描条码或手动输入..."
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScanSearch()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScanDialogOpen(false)}>取消</Button>
              <Button onClick={handleScanSearch}>查询</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
