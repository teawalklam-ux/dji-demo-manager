import { useEffect, useRef, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Html5Qrcode, type Html5QrcodeResult } from 'html5-qrcode'
import {
  getBarcodeScanProfile,
  isAcceptedScanResult,
  type BarcodeScanMode,
} from './barcode-scan-profile'
import { ScanLine, Camera } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (barcode: string) => void
  mode?: BarcodeScanMode
}

// Unique ID counter to avoid duplicate DOM IDs
let idCounter = 0

export function BarcodeScanner({ open, onOpenChange, onScan, mode = 'barcode' }: BarcodeScannerProps) {
  const [error, setError] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScanResult, setLastScanResult] = useState('')
  const [scanNotice, setScanNotice] = useState('')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const readerIdRef = useRef(`barcode-reader-${++idCounter}`)
  const mountedRef = useRef(false)
  const scanProfile = getBarcodeScanProfile(mode)

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
      setScanNotice('')

      // 只配置系统使用的条码格式，CODE128 优先
      const scanner = new Html5Qrcode(readerId, {
        verbose: false,
        formatsToSupport: [...scanProfile.formatsToSupport],
      })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: scanProfile.fps,
          qrbox: { ...scanProfile.qrbox },
          aspectRatio: scanProfile.aspectRatio,
          disableFlip: true,   // 禁用翻转，提高识别速度
        },
        (decodedText, decodedResult: Html5QrcodeResult) => {
          // 成功识别
          const text = decodedText.trim()
          const format = decodedResult.result.format?.format

          if (!isAcceptedScanResult(mode, text, format)) {
            setScanNotice(scanProfile.mismatchMessage)
            return
          }

          setLastScanResult(text)
          setScanNotice('')
          onScan(text)
          void stopScanning()
          onOpenChange(false)
        },
        () => {
          // 每帧未识别到，忽略
        }
      )
    } catch (err: unknown) {
      setScanning(false)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
        setError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头')
      } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
        setError('未找到摄像头设备，请手动输入')
      } else {
        setError('无法启动扫描，请手动输入')
      }
      console.error('Scanner error:', err)
    }
  }, [mode, onScan, onOpenChange, scanProfile, stopScanning])

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
      setScanNotice('')
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
          <DialogTitle>{scanProfile.title}</DialogTitle>
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

          {scanNotice && !lastScanResult && (
            <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-700">
              {scanNotice}
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
                placeholder={scanProfile.placeholder}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button onClick={handleManualSubmit}>确认</Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {scanProfile.helpText}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
