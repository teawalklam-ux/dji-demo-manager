import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'
import { BarcodeGenerator } from './barcode-generator'

interface BarcodePrintProps {
  barcode: string
  itemName: string
  model: string
}

export function BarcodePrint({ barcode, itemName, model }: BarcodePrintProps) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>条码标签 - ${itemName}</title>
        <style>
          body { margin: 0; padding: 20px; font-family: sans-serif; }
          .label { border: 1px solid #000; padding: 12px; display: inline-block; text-align: center; }
          .item-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
          .model { font-size: 12px; color: #666; margin-bottom: 8px; }
          svg { display: block; margin: 0 auto; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.print()
  }

  return (
    <div>
      <div ref={printRef} className="inline-block border border-dashed border-gray-300 p-4 text-center rounded">
        <div className="text-sm font-bold">{itemName}</div>
        <div className="text-xs text-muted-foreground mb-2">{model}</div>
        <BarcodeGenerator value={barcode} />
      </div>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="mr-1 h-4 w-4" />
          打印标签
        </Button>
      </div>
    </div>
  )
}
