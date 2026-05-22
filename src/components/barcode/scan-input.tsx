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
}

export function ScanInput({ value, onChange, placeholder, id, className }: ScanInputProps) {
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
      />
    </>
  )
}
