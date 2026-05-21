import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Html5Qrcode } from 'html5-qrcode'
import { ScanLine } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (barcode: string) => void
}

export function BarcodeScanner({ open, onOpenChange, onScan }: BarcodeScannerProps) {
  const [error, setError] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [scanning, setScanning] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const readerId = 'barcode-reader'

  useEffect(() => {
    if (!open) {
      stopScanning()
      return
    }

    setError('')
    setManualBarcode('')
    setScanning(false)

    // Small delay to let dialog render before starting camera
    const timer = setTimeout(() => {
      startScanning()
    }, 300)

    return () => {
      clearTimeout(timer)
      stopScanning()
    }
  }, [open])

  async function startScanning() {
    try {
      setScanning(true)
      const scanner = new Html5Qrcode(readerId)
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // On successful scan
          onScan(decodedText)
          stopScanning()
          onOpenChange(false)
        },
        () => {
          // Ignore scan failures (no barcode in frame)
        }
      )
    } catch (err) {
      setScanning(false)
      setError('无法启动摄像头，请检查权限或手动输入')
      console.error('Scanner error:', err)
    }
  }

  async function stopScanning() {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState()
        if (state === 2) { // SCANNING
          await scannerRef.current.stop()
        }
        await scannerRef.current.clear()
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null
    }
    setScanning(false)
  }

  const handleManualSubmit = () => {
    if (manualBarcode.trim()) {
      onScan(manualBarcode.trim())
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) stopScanning(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>扫描条码 / 二维码</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          ) : (
            <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-black flex items-center justify-center">
              <div id={readerId} className="w-full h-full" />
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <ScanLine className="size-12 text-white/50" />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">或手动输入：</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                placeholder="输入条码编号"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button onClick={handleManualSubmit}>确认</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
