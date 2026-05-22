import { useEffect, useRef, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Html5Qrcode } from 'html5-qrcode'
import { BARCODE_SCAN_FORMATS, BARCODE_SCAN_QRBOX, BARCODE_FORMAT } from '@/lib/constants'
import { ScanLine, Camera } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (barcode: string) => void
}

// Unique ID counter to avoid duplicate DOM IDs
let idCounter = 0

export function BarcodeScanner({ open, onOpenChange, onScan }: BarcodeScannerProps) {
  const [error, setError] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScanResult, setLastScanResult] = useState('')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const readerIdRef = useRef(`barcode-reader-${++idCounter}`)
  const mountedRef = useRef(false)

  const stopScanning = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState()
        if (state === 2) { // SCANNING state
          await scannerRef.current.stop()
        }
        scannerRef.current.clear()
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null
    }
    setScanning(false)
  }, [])

  const startScanning = useCallback(async () => {
    const readerId = readerIdRef.current
    const readerEl = document.getElementById(readerId)
    if (!readerEl) {
      setError('扫描器初始化失败，请重试')
      return
    }

    try {
      setScanning(true)
      setError('')

      // 只配置系统使用的条码格式，CODE128 优先
      const scanner = new Html5Qrcode(readerId, {
        verbose: false,
        formatsToSupport: [...BARCODE_SCAN_FORMATS],
      })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 20,  // 提高帧率 (原15→20)，加快识别速度
          qrbox: { ...BARCODE_SCAN_QRBOX },  // 横向矩形扫描区域，适合1D条码
          aspectRatio: 1.778,  // 16:9 宽屏比例，更适合横向条码
          disableFlip: true,   // 禁用翻转，提高识别速度
        },
        (decodedText) => {
          // 成功识别
          const text = decodedText.trim()

          // 优先匹配系统条码格式 (DJI-YYYYMMDD-XXXX)
          if (text.startsWith('DJI-')) {
            setLastScanResult(text)
            onScan(text)
            stopScanning()
            onOpenChange(false)
            return
          }

          // 其他条码也接受（SN码、序列号等场景）
          setLastScanResult(text)
          onScan(text)
          stopScanning()
          onOpenChange(false)
        },
        () => {
          // 每帧未识别到，忽略
        }
      )
    } catch (err: any) {
      setScanning(false)
      const msg = err?.message || String(err)
      if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
        setError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头')
      } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
        setError('未找到摄像头设备，请手动输入')
      } else {
        setError('无法启动扫描，请手动输入')
      }
      console.error('Scanner error:', err)
    }
  }, [onScan, onOpenChange, stopScanning])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopScanning()
    }
  }, [stopScanning])

  // Handle dialog open/close
  useEffect(() => {
    if (!open) {
      stopScanning()
      setManualValue('')
      setLastScanResult('')
      setError('')
      return
    }

    // Wait for dialog DOM to be fully rendered before starting
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        startScanning()
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [open, startScanning, stopScanning])

  const handleManualSubmit = () => {
    if (manualValue.trim()) {
      onScan(manualValue.trim())
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) stopScanning()
      onOpenChange(v)
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>扫描条码 / 二维码</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <div className="space-y-3">
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              <Button variant="outline" onClick={startScanning} className="w-full">
                <Camera className="size-4 mr-2" />
                重新尝试扫描
              </Button>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-md bg-black">
              {/* html5-qrcode will render video inside this div */}
              <div id={readerIdRef.current} style={{ width: '100%' }} />
              {!scanning && (
                <div className="flex flex-col items-center justify-center py-12 text-white/50">
                  <ScanLine className="size-10 mb-2" />
                  <p className="text-sm">正在启动摄像头...</p>
                </div>
              )}
            </div>
          )}

          {lastScanResult && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              已识别：{lastScanResult}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">或手动输入：</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                placeholder="输入条码或序列号"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button onClick={handleManualSubmit}>确认</Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            系统条码格式：{BARCODE_FORMAT} · 将条码对准横向扫描框
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
