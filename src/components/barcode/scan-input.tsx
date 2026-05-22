import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BarcodeScanner } from './barcode-scanner'
import { ScanLine } from 'lucide-react'

interface ScanInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  className?: string
  /** 扫描模式：barcode=系统条码，sn=SN码/序列号(支持更多格式) */
  mode?: 'barcode' | 'sn'
}

export function ScanInput({ value, onChange, placeholder, id, className, mode = 'sn' }: ScanInputProps) {
  const [scannerOpen, setScannerOpen] = useState(false)

  return (
    <>
      <div className={`flex items-center gap-2 ${className || ''}`}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => setScannerOpen(true)}
          title="扫描条码"
        >
          <ScanLine className="size-4" />
        </Button>
      </div>
      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(code) => onChange(code)}
        mode={mode}
      />
    </>
  )
}
