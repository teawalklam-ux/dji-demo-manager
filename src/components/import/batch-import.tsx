import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth-context'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import type { Category } from '@/types'

// ===== 模板列定义 =====
const TEMPLATE_HEADERS = [
  { key: 'name', label: '产品名称 *', required: true },
  { key: 'model', label: '产品型号 *', required: true },
  { key: 'category_name', label: '产品分类 *', required: true, hint: '必须与系统分类名一致' },
  { key: 'serial_number', label: '序列号', required: false },
  { key: 'purchase_date', label: '购买日期', required: false, hint: '格式: YYYY-MM-DD' },
  { key: 'purchase_price', label: '购买价格', required: false, hint: '数字，单位: 元' },
  { key: 'location', label: '存放位置', required: false },
  { key: 'notes', label: '备注', required: false },
]

interface ParsedRow {
  index: number
  name: string
  model: string
  category_name: string
  category_id?: string
  serial_number?: string
  purchase_date?: string
  purchase_price?: number
  location?: string
  notes?: string
  valid: boolean
  errors: string[]
}

interface ImportResult {
  total: number
  success: number
  failed: number
  errors: { row: number; message: string }[]
}

interface BatchImportProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  onSuccess: () => void
}

export function BatchImport({ open, onOpenChange, categories, onSuccess }: BatchImportProps) {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'result'>('upload')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [importResult, setImportResult] = useState<ImportResult>({ total: 0, success: 0, failed: 0, errors: [] })
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // 分类名 → ID 映射
  const categoryMap = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]))

  // ===== 下载模板 =====
  function handleDownloadTemplate() {
    const headers = TEMPLATE_HEADERS.map(h => h.label)
    const sampleRow = [
      'DJI Mavic 3 Pro',
      'M3P-001',
      '无人机',
      'SN20240001',
      '2024-01-15',
      '13888',
      'A区货架1',
      '含畅飞套装',
    ]

    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow])

    // 设置列宽
    ws['!cols'] = [
      { wch: 18 }, // 产品名称
      { wch: 14 }, // 产品型号
      { wch: 14 }, // 产品分类
      { wch: 18 }, // 序列号
      { wch: 14 }, // 购买日期
      { wch: 12 }, // 购买价格
      { wch: 14 }, // 存放位置
      { wch: 20 }, // 备注
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '样机导入模板')

    // 添加说明 sheet
    const instructionHeaders = ['字段名', '是否必填', '说明']
    const instructionData = TEMPLATE_HEADERS.map(h => [
      h.label,
      h.required ? '是' : '否',
      h.hint || '',
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([instructionHeaders, ...instructionData])
    ws2['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(wb, ws2, '填写说明')

    XLSX.writeFile(wb, '样机批量导入模板.xlsx')
  }

  // ===== 解析文件 =====
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setError('请选择 .xlsx、.xls 或 .csv 文件')
      return
    }

    setError(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })

        // 读取第一个 sheet
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const jsonData: Record<string, string | number | undefined>[] = XLSX.utils.sheet_to_json(sheet)

        if (jsonData.length === 0) {
          setError('文件中没有数据行')
          return
        }

        if (jsonData.length > 500) {
          setError(`数据行数 (${jsonData.length}) 超过单次上限 500 行，请分批导入`)
          return
        }

        // 解析并校验
        const rows: ParsedRow[] = jsonData.map((row, idx) => {
          const errors: string[] = []
          const parsed: ParsedRow = {
            index: idx + 2, // Excel 行号（1-based + 标题行）
            name: String(row['产品名称 *'] ?? row['产品名称'] ?? '').trim(),
            model: String(row['产品型号 *'] ?? row['产品型号'] ?? '').trim(),
            category_name: String(row['产品分类 *'] ?? row['产品分类'] ?? row['分类'] ?? '').trim(),
            serial_number: String(row['序列号'] ?? '').trim() || undefined,
            purchase_date: formatDateValue(row['购买日期']),
            purchase_price: parsePrice(row['购买价格']),
            location: String(row['存放位置'] ?? row['位置'] ?? '').trim() || undefined,
            notes: String(row['备注'] ?? '').trim() || undefined,
            valid: true,
            errors: [],
          }

          // 必填校验
          if (!parsed.name) {
            errors.push('产品名称不能为空')
          }
          if (!parsed.model) {
            errors.push('产品型号不能为空')
          }
          if (!parsed.category_name) {
            errors.push('产品分类不能为空')
          } else {
            // 分类名匹配
            const categoryId = categoryMap.get(parsed.category_name.toLowerCase())
            if (!categoryId) {
              errors.push(`分类「${parsed.category_name}」在系统中不存在`)
            } else {
              parsed.category_id = categoryId
            }
          }

          // 日期格式校验
          if (parsed.purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.purchase_date)) {
            errors.push('购买日期格式错误，应为 YYYY-MM-DD')
          }

          // 价格校验
          if (parsed.purchase_price !== undefined && isNaN(parsed.purchase_price)) {
            errors.push('购买价格必须为数字')
          }

          parsed.errors = errors
          parsed.valid = errors.length === 0
          return parsed
        })

        setParsedRows(rows)
        setStep('preview')
      } catch (err) {
        console.error('解析文件失败:', err)
        setError('文件解析失败，请检查文件格式是否正确')
      }
    }
    reader.readAsArrayBuffer(file)

    // 重置 input 以便再次选同一文件
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 日期值格式化
  function formatDateValue(val: string | number | undefined): string | undefined {
    if (val === undefined || val === null || val === '') return undefined
    const str = String(val).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-')
    // Excel 数字日期序列号（如 45678）
    const num = Number(str)
    if (!isNaN(num) && num > 40000 && num < 60000) {
      const date = XLSX.SSF.parse_date_code(num)
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
      }
    }
    return str
  }

  // 价格解析
  function parsePrice(val: string | number | undefined): number | undefined {
    if (val === undefined || val === null || val === '') return undefined
    const num = Number(val)
    return isNaN(num) ? undefined : num
  }

  // ===== 执行批量导入 =====
  const doImport = useCallback(async () => {
    const validRows = parsedRows.filter(r => r.valid)
    if (validRows.length === 0) return

    setStep('importing')
    setProgress(0)

    const result: ImportResult = { total: validRows.length, success: 0, failed: 0, errors: [] }
    const userId = user?.id

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        // 1. 插入样机
        const { data: item, error: insertError } = await supabase
          .from('items')
          .insert({
            name: row.name,
            model: row.model,
            category_id: row.category_id!,
            serial_number: row.serial_number || null,
            purchase_date: row.purchase_date || null,
            purchase_price: row.purchase_price || null,
            location: row.location || null,
            notes: row.notes || null,
            specs: {},
            status: 'in_stock',
          })
          .select('id')
          .single()

        if (insertError) throw insertError

        // 2. 记录库存变动
        if (item && userId) {
          await supabase.from('stock_movements').insert({
            item_id: item.id,
            movement_type: 'new_entry',
            operator_id: userId,
            notes: '批量导入入库',
          })
        }

        result.success++
      } catch (err) {
        result.failed++
        result.errors.push({
          row: row.index,
          message: err instanceof Error ? err.message : '插入失败',
        })
      }

      setProgress(Math.round(((i + 1) / validRows.length) * 100))
    }

    setImportResult(result)
    setStep('result')

    if (result.success > 0) {
      onSuccess()
    }
  }, [parsedRows, user, onSuccess])

  // ===== 重置状态 =====
  function reset() {
    setStep('upload')
    setParsedRows([])
    setImportResult({ total: 0, success: 0, failed: 0, errors: [] })
    setProgress(0)
    setError(null)
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  const validCount = parsedRows.filter(r => r.valid).length
  const invalidCount = parsedRows.filter(r => !r.valid).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            批量导入样机
          </DialogTitle>
        </DialogHeader>

        {/* ===== Step 1: 上传 ===== */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">
              请先下载模板文件，按格式填写后上传。单次最多 500 条。
            </div>

            <Button variant="outline" onClick={handleDownloadTemplate} className="w-full">
              <Download className="size-4" />
              下载导入模板
            </Button>

            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                <Upload className="size-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">点击或拖拽文件到此处</p>
                <p className="text-xs text-muted-foreground mt-1">支持 .xlsx、.xls、.csv 格式</p>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* ===== Step 2: 预览 ===== */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <Badge variant="secondary">共 {parsedRows.length} 条</Badge>
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle2 className="size-3 mr-1" />
                有效 {validCount} 条
              </Badge>
              {invalidCount > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  <XCircle className="size-3 mr-1" />
                  无效 {invalidCount} 条
                </Badge>
              )}
            </div>

            {invalidCount > 0 && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
                有 {invalidCount} 条数据校验不通过，导入时将自动跳过。请检查下方标红行。
              </div>
            )}

            <div className="border rounded-md overflow-x-auto max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">状态</TableHead>
                    <TableHead>产品名称</TableHead>
                    <TableHead>型号</TableHead>
                    <TableHead>分类</TableHead>
                    <TableHead>序列号</TableHead>
                    <TableHead>位置</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, idx) => (
                    <TableRow key={idx} className={!row.valid ? 'bg-red-50' : ''}>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle2 className="size-4 text-green-600" />
                        ) : (
                          <XCircle className="size-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{row.name || '-'}</TableCell>
                      <TableCell>{row.model || '-'}</TableCell>
                      <TableCell>{row.category_name || '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.serial_number || '-'}</TableCell>
                      <TableCell>{row.location || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* 错误详情 */}
            {invalidCount > 0 && (
              <div className="space-y-1 max-h-[100px] overflow-y-auto">
                {parsedRows.filter(r => !r.valid).map((row, idx) => (
                  <div key={idx} className="text-xs text-red-600">
                    第 {row.index} 行: {row.errors.join('；')}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={reset}>返回</Button>
              <Button onClick={doImport} disabled={validCount === 0}>
                导入 {validCount} 条有效数据
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ===== Step 3: 导入中 ===== */}
        {step === 'importing' && (
          <div className="space-y-4 py-8">
            <div className="text-center">
              <Spinner className="size-8 mx-auto mb-4" />
              <p className="font-medium">正在导入数据...</p>
              <p className="text-sm text-muted-foreground mt-1">{progress}%</p>
            </div>
            <Progress value={progress} />
          </div>
        )}

        {/* ===== Step 4: 结果 ===== */}
        {step === 'result' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              {importResult.failed === 0 ? (
                <CheckCircle2 className="size-12 mx-auto text-green-500 mb-2" />
              ) : (
                <AlertCircle className="size-12 mx-auto text-amber-500 mb-2" />
              )}
              <p className="text-lg font-medium">
                导入{importResult.failed === 0 ? '完成' : '完成（部分失败）'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border rounded-lg p-3">
                <div className="text-2xl font-bold">{importResult.total}</div>
                <div className="text-xs text-muted-foreground">总计</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-2xl font-bold text-green-600">{importResult.success}</div>
                <div className="text-xs text-muted-foreground">成功</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-2xl font-bold text-red-600">{importResult.failed}</div>
                <div className="text-xs text-muted-foreground">失败</div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="rounded-md bg-red-50 p-3 space-y-1 max-h-[120px] overflow-y-auto">
                {importResult.errors.map((err, idx) => (
                  <div key={idx} className="text-xs text-red-600">
                    第 {err.row} 行: {err.message}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
