import { useEffect, useRef, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import QrScanner from 'qr-scanner'
import {
  getBarcodeScanProfile,
  getSelectableScanModes,
  isAcceptedScanResult,
  type BarcodeScanMode,
} from './barcode-scan-profile'
import { ScanLine, Camera, QrCode } from 'lucide-react'

interface BarcodeScannerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (barcode: string) => void
  mode?: BarcodeScanMode
}

export function BarcodeScanner({ open, onOpenChange, onScan, mode = 'barcode' }: BarcodeScannerProps) {
  const [activeMode, setActiveMode] = useState<BarcodeScanMode>(mode)
  const [error, setError] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScanResult, setLastScanResult] = useState('')
  const [scanNotice, setScanNotice] = useState('')
  // html5-qrcode 实例（条形码/mixed 模式）
  const html5Ref = useRef<Html5Qrcode | null>(null)
  // qr-scanner 实例（二维码模式）
  const qrRef = useRef<QrScanner | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mountedRef = useRef(false)
  const scanProfile = getBarcodeScanProfile(activeMode)
  const selectableModes = getSelectableScanModes()

  const stopScanning = useCallback(() => {
    // 清理 html5-qrcode
    if (html5Ref.current) {
      try {
        html5Ref.current.stop()
      } catch {
        // Ignore
      }
      try {
        html5Ref.current.clear()
      } catch {
        // Ignore
      }
      html5Ref.current = null
    }
    // 清理 qr-scanner
    if (qrRef.current) {
      try {
        qrRef.current.destroy()
      } catch {
        // Ignore
      }
      qrRef.current = null
    }
    setScanning(false)
  }, [])

  const onScanSuccess = useCallback((text: string, source: 'qr' | 'barcode') => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (!isAcceptedScanResult(activeMode, trimmed, source)) {
      setScanNotice(scanProfile.mismatchMessage)
      return
    }

    setLastScanResult(trimmed)
    setScanNotice('')
    onScan(trimmed)
    stopScanning()
    onOpenChange(false)
  }, [activeMode, onScan, onOpenChange, scanProfile.mismatchMessage, stopScanning])

  /** 条形码/mixed 模式：使用 html5-qrcode */
  const startHtml5Scanning = useCallback(async () => {
    const containerId = 'html5-qr-reader'
    // 确保容器存在
    const container = document.getElementById(containerId)
    if (!container) {
      setError('扫描器初始化失败，请重试')
      return
    }

    try {
      setScanning(true)
      setError('')
      setScanNotice('')

      const scanner = new Html5Qrcode(containerId, {
        formatsToSupport: scanProfile.html5Formats ?? [Html5QrcodeSupportedFormats.CODE_128],
        verbose: false,
      })
      html5Ref.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: scanProfile.html5Fps ?? 20,
          qrbox: scanProfile.html5Qrbox ?? { width: 280, height: 160 },
        },
        (decodedText, decodedResult) => {
          // 判断是条形码还是二维码
          const format = decodedResult?.result?.format?.format
          const isBarcode = format === Html5QrcodeSupportedFormats.CODE_128
          onScanSuccess(decodedText, isBarcode ? 'barcode' : 'qr')
        },
        () => {
          // 每帧未识别，忽略
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
      console.error('html5-qrcode error:', err)
    }
  }, [scanProfile, onScanSuccess])

  /** 二维码模式：使用 qr-scanner（支持反色） */
  const startQrScanning = useCallback(async () => {
    const video = videoRef.current
    if (!video) {
      setError('扫描器初始化失败，请重试')
      return
    }

    try {
      setScanning(true)
      setError('')
      setScanNotice('')

      const scanner = new QrScanner(
        video,
        (result: QrScanner.ScanResult) => {
          onScanSuccess(result.data, 'qr')
        },
        {
          onDecodeError: () => {},
          preferredCamera: 'environment',
          maxScansPerSecond: scanProfile.qrMaxScansPerSecond ?? 15,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
        }
      )

      // 支持正常+反色二维码
      scanner.setInversionMode(scanProfile.qrInversionMode ?? 'both')

      qrRef.current = scanner
      await scanner.start()
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
      console.error('qr-scanner error:', err)
    }
  }, [scanProfile, onScanSuccess])

  const startScanning = useCallback(async () => {
    stopScanning()
    if (scanProfile.engine === 'html5-qrcode') {
      await startHtml5Scanning()
    } else {
      await startQrScanning()
    }
  }, [scanProfile.engine, startHtml5Scanning, startQrScanning, stopScanning])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopScanning()
    }
  }, [stopScanning])

  useEffect(() => {
    if (open) {
      setActiveMode(mode)
    }
  }, [mode, open])

  useEffect(() => {
    if (!open) {
      stopScanning()
      setManualValue('')
      setLastScanResult('')
      setScanNotice('')
      setError('')
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        void (async () => {
          if (mountedRef.current && !cancelled) {
            await startScanning()
          }
        })()
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeMode, open, startScanning, stopScanning])

  const handleModeChange = (nextMode: BarcodeScanMode) => {
    if (nextMode === activeMode) return
    setActiveMode(nextMode)
    setManualValue('')
    setLastScanResult('')
    setScanNotice('')
    setError('')
    stopScanning()
  }

  const handleManualSubmit = () => {
    if (manualValue.trim()) {
      onScan(manualValue.trim())
      onOpenChange(false)
    }
  }

  const isQrMode = scanProfile.engine === 'qr-scanner'

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
          <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1">
            {selectableModes.map((scanMode) => {
              const active = scanMode === activeMode
              const Icon = scanMode === 'qrcode' ? QrCode : ScanLine
              return (
                <Button
                  key={scanMode}
                  type="button"
                  variant={active ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 justify-center gap-1.5"
                  aria-pressed={active}
                  onClick={() => handleModeChange(scanMode)}
                >
                  <Icon className="size-4" />
                  {getModeLabel(scanMode)}
                </Button>
              )
            })}
          </div>

          {error ? (
            <div className="space-y-3">
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              <Button variant="outline" onClick={startScanning} className="w-full">
                <Camera className="size-4 mr-2" />
                重新尝试扫描
              </Button>
            </div>
          ) : isQrMode ? (
            /* qr-scanner 渲染：直接使用 video 元素 */
            <div className="relative overflow-hidden rounded-md bg-black">
              <video
                ref={videoRef}
                className="w-full"
                style={{ objectFit: 'cover' }}
                muted
                playsInline
              />
              {!scanning && (
                <div className="flex flex-col items-center justify-center py-12 text-white/50">
                  <ScanLine className="size-10 mb-2" />
                  <p className="text-sm">正在启动摄像头...</p>
                </div>
              )}
            </div>
          ) : (
            /* html5-qrcode 渲染：使用容器 div */
            <div className="relative overflow-hidden rounded-md bg-black">
              <div id="html5-qr-reader" className="w-full" />
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

function getModeLabel(mode: BarcodeScanMode) {
  if (mode === 'qrcode') return '二维码'
  if (mode === 'mixed') return '兼容'
  return '条形码'
}
