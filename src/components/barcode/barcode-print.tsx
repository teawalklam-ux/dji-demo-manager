import { useRef, useEffect, useState, useCallback } from 'react'
import JsBarcode from 'jsbarcode'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Printer } from 'lucide-react'
import { BARCODE_GENERATE_OPTIONS } from '@/lib/constants'
import type { Item } from '@/types'

// ===== 单个条码标签渲染 =====
interface BarcodeLabelProps {
  barcode: string
  itemName: string
  model: string
  categoryName?: string
  location?: string | null
}

function BarcodeLabel({ barcode, itemName, model, categoryName, location }: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (svgRef.current && barcode) {
      try {
        JsBarcode(svgRef.current, barcode, {
          ...BARCODE_GENERATE_OPTIONS,
        })
      } catch (err) {
        console.error('条码渲染失败:', err)
      }
    }
  }, [barcode])

  return (
    <div className="barcode-label">
      <div className="label-header">
        <span className="label-name">{itemName}{location ? ` (${location})` : ''}</span>
        <span className="label-category">{categoryName || ''}</span>
      </div>
      <div className="label-model">{model}</div>
      <svg ref={svgRef} />
    </div>
  )
}

// ===== A4 布局参数 =====
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
const A4_MARGIN_MM = 10

// 标签尺寸选项 (单位 mm)
const LABEL_PRESETS = {
  small: { width: 50, height: 30, label: '小号 (50×30mm)' },
  medium: { width: 70, height: 40, label: '中号 (70×40mm)' },
  large: { width: 100, height: 55, label: '大号 (100×55mm)' },
}

type LabelSize = keyof typeof LABEL_PRESETS

// 计算每页能放多少标签
function calcGrid(size: LabelSize) {
  const preset = LABEL_PRESETS[size]
  const cols = Math.floor((A4_WIDTH_MM - 2 * A4_MARGIN_MM) / preset.width)
  const rows = Math.floor((A4_HEIGHT_MM - 2 * A4_MARGIN_MM) / preset.height)
  return { cols, rows, perPage: cols * rows }
}

// ===== 批量打印主组件 =====
interface BatchBarcodePrintProps {
  items: Item[]
  selectedIds: string[]
  onClose: () => void
}

export function BatchBarcodePrint({ items, selectedIds, onClose }: BatchBarcodePrintProps) {
  const [labelSize, setLabelSize] = useState<LabelSize>('medium')
  const [copiesPerItem, setCopiesPerItem] = useState(1)
  const [selectedItems, setSelectedItems] = useState<Item[]>(
    items.filter(item => selectedIds.includes(item.id))
  )
  const printAreaRef = useRef<HTMLDivElement>(null)

  const grid = calcGrid(labelSize)
  const preset = LABEL_PRESETS[labelSize]

  // 生成带副本的标签列表
  const labels = selectedItems.flatMap(item =>
    Array.from({ length: copiesPerItem }, (_, i) => ({
      id: `${item.id}-${i}`,
      barcode: item.barcode,
      itemName: item.name,
      model: item.model,
      categoryName: item.category?.name,
      location: item.location,
    }))
  )

  const totalPages = Math.ceil(labels.length / grid.perPage)

  const toggleItem = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.id === itemId)
      if (exists) return prev.filter(i => i.id !== itemId)
      const item = items.find(i => i.id === itemId)
      return item ? [...prev, item] : prev
    })
  }, [items])

  const toggleAll = useCallback(() => {
    setSelectedItems(prev =>
      prev.length === items.length ? [] : [...items]
    )
  }, [items])

  const handlePrint = useCallback(() => {
    const printContent = printAreaRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) return

    // 构建打印页面 - 使用 mm 单位精确控制 A4 布局
    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>条码标签打印</title>
  <style>
    @page {
      size: A4;
      margin: ${A4_MARGIN_MM}mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      width: ${A4_WIDTH_MM}mm;
    }
    .page {
      width: ${A4_WIDTH_MM - 2 * A4_MARGIN_MM}mm;
      min-height: ${A4_HEIGHT_MM - 2 * A4_MARGIN_MM}mm;
      display: grid;
      grid-template-columns: repeat(${grid.cols}, ${preset.width}mm);
      grid-template-rows: repeat(auto-fill, ${preset.height}mm);
      gap: 0;
      page-break-after: always;
    }
    .page:last-child {
      page-break-after: auto;
    }
    .barcode-label {
      width: ${preset.width}mm;
      height: ${preset.height}mm;
      border: 0.5pt solid #ccc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1mm 2mm;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .label-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      gap: 2mm;
    }
    .label-name {
      font-size: 8pt;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .label-category {
      font-size: 6pt;
      color: #666;
      white-space: nowrap;
    }
    .label-model {
      font-size: 6pt;
      color: #999;
      margin-bottom: 0.5mm;
    }
    .barcode-label svg {
      max-width: ${preset.width - 4}mm;
      max-height: ${preset.height * 0.55}mm;
    }
    /* 打印时隐藏非标签内容 */
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${printContent.innerHTML}
  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>`)
    printWindow.document.close()
  }, [grid, preset])

  // 将标签按页分组
  const pages: typeof labels[] = []
  for (let i = 0; i < labels.length; i += grid.perPage) {
    pages.push(labels.slice(i, i + grid.perPage))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">批量打印条码标签</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* 左侧：设置 + 选择列表 */}
          <div className="w-80 border-r flex flex-col overflow-hidden">
            {/* 打印设置 */}
            <div className="p-4 space-y-4 border-b">
              <h3 className="font-medium text-sm">打印设置</h3>

              <div className="space-y-2">
                <Label>标签尺寸</Label>
                <Select value={labelSize} onValueChange={(v) => setLabelSize(v as LabelSize)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LABEL_PRESETS).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>每项打印份数</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={copiesPerItem}
                  onChange={e => setCopiesPerItem(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-24"
                />
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p>A4 纸 · {grid.cols}列 × {grid.rows}行 = 每页 {grid.perPage} 个标签</p>
                <p>共 {labels.length} 个标签 · {totalPages} 页</p>
              </div>

              <div className="flex gap-2">
                <Button onClick={handlePrint} disabled={selectedItems.length === 0} className="flex-1">
                  <Printer className="size-4" />
                  打印
                </Button>
              </div>
            </div>

            {/* 样机选择列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              <div className="flex items-center gap-2 pb-2 border-b mb-2">
                <Checkbox
                  checked={selectedItems.length === items.length}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm font-medium">
                  全选 ({selectedItems.length}/{items.length})
                </span>
              </div>
              {items.map(item => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={selectedItems.some(i => i.id === item.id)}
                    onCheckedChange={() => toggleItem(item.id)}
                  />
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.barcode}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 右侧：A4 预览 */}
          <div className="flex-1 overflow-y-auto p-6 bg-muted/30">
            <div className="flex flex-col items-center gap-6">
              {pages.map((page, pageIdx) => (
                <div key={pageIdx} className="relative">
                  <div className="absolute -top-5 left-0 text-xs text-muted-foreground">
                    第 {pageIdx + 1} 页
                  </div>
                  {/* A4 比例预览 (缩放到屏幕) */}
                  <div
                    className="bg-white shadow-lg border"
                    style={{
                      width: `${A4_WIDTH_MM - 2 * A4_MARGIN_MM}mm`,
                      minHeight: `${A4_HEIGHT_MM - 2 * A4_MARGIN_MM}mm`,
                      display: 'grid',
                      gridTemplateColumns: `repeat(${grid.cols}, ${preset.width}mm)`,
                      gridTemplateRows: `repeat(auto-fill, ${preset.height}mm)`,
                      padding: 0,
                    }}
                  >
                    {page.map(label => (
                      <div
                        key={label.id}
                        className="border border-gray-200 flex flex-col items-center justify-center p-1"
                        style={{ width: `${preset.width}mm`, height: `${preset.height}mm` }}
                      >
                        <div className="flex justify-between items-center w-full gap-1">
                          <span className="text-[6pt] font-bold truncate">{label.itemName}{label.location ? ` (${label.location})` : ''}</span>
                          <span className="text-[5pt] text-gray-500 whitespace-nowrap">{label.categoryName}</span>
                        </div>
                        <div className="text-[5pt] text-gray-400">{label.model}</div>
                        <BarcodeLabel
                          barcode={label.barcode}
                          itemName={label.itemName}
                          model={label.model}
                          categoryName={label.categoryName}
                          location={label.location}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {labels.length === 0 && (
                <div className="text-center text-muted-foreground py-20">
                  请在左侧选择要打印的样机
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 打印区域（隐藏，用于提取 HTML） */}
      <div ref={printAreaRef} style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        {pages.map((page, pageIdx) => (
          <div key={pageIdx} className="page">
            {page.map(label => (
              <div key={label.id} className="barcode-label">
                <div className="label-header">
                  <span className="label-name">{label.itemName}{label.location ? ` (${label.location})` : ''}</span>
                  <span className="label-category">{label.categoryName}</span>
                </div>
                <div className="label-model">{label.model}</div>
                <BarcodeLabel
                  barcode={label.barcode}
                  itemName={label.itemName}
                  model={label.model}
                  categoryName={label.categoryName}
                  location={label.location}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 单个条码打印（保留兼容） =====
interface BarcodePrintProps {
  barcode: string
  itemName: string
  model: string
  location?: string | null
}

export function BarcodePrint({ barcode, itemName, model, location }: BarcodePrintProps) {
  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>条码标签 - ${itemName}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; padding: 0; font-family: "Microsoft YaHei", sans-serif; }
    .label {
      width: 70mm;
      height: 40mm;
      border: 0.5pt solid #ccc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2mm;
    }
    .label-name { font-size: 10pt; font-weight: bold; }
    .label-model { font-size: 8pt; color: #666; margin-bottom: 2mm; }
    svg { max-width: 60mm; }
  </style>
</head>
<body>
    <div class="label">
    <div class="label-name">${itemName}${location ? ` (${location})` : ''}</div>
    <div class="label-model">${model}</div>
    <svg id="barcode"></svg>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11/dist/JsBarcode.all.min.js"></script>
  <script>
    JsBarcode("#barcode", "${barcode}", { format: "${BARCODE_GENERATE_OPTIONS.format}", width: ${BARCODE_GENERATE_OPTIONS.width}, height: ${BARCODE_GENERATE_OPTIONS.height}, displayValue: ${BARCODE_GENERATE_OPTIONS.displayValue}, fontSize: ${BARCODE_GENERATE_OPTIONS.fontSize}, margin: ${BARCODE_GENERATE_OPTIONS.margin}, flat: ${BARCODE_GENERATE_OPTIONS.flat} });
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`)
    printWindow.document.close()
  }

  return (
    <Button variant="outline" size="sm" onClick={handlePrint}>
      <Printer className="mr-1 h-4 w-4" />
      打印标签
    </Button>
  )
}
