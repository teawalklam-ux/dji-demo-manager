import { useEffect, useRef, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import QrScanner from 'qr-scanner'
import {
  getBarcodeScanProfile,
  getSelectableScanModes,
  isAcceptedScanResult,
  isSystemBarcode,
  classifyScanResult,
  type BarcodeScanMode,
  type BarcodeScanKind,
} from './barcode-scan-profile'
import { ScanLine, Camera, QrCode, Zap, Package, X } from 'lucide-react'

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
  const [lastScanKind, setLastScanKind] = useState<BarcodeScanKind | null>(null)
  const [scanNotice, setScanNotice] = useState('')
  // html5-qrcode 实例（条形码/mixed 模式）
  const html5Ref = useRef<Html5Qrcode | null>(null)
  // qr-scanner 实例（二维码模式）
  const qrRef = useRef<QrScanner | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mountedRef = useRef(false)
  /** 非系统条码确认计数：累计相同结果直到达到 genericConfirmCount */
  const pendingRef = useRef<{ text: string; count: number }>({ text: '', count: 0 })
  /** 关闭延迟定时器（通用条码反馈） */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanProfile = getBarcodeScanProfile(activeMode)
  const selectableModes = getSelectableScanModes()

  const stopScanning = useCallback(() => {
    // 清理关闭延迟定时器
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
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

    const kind = classifyScanResult(trimmed, source)

    // 系统条码：快速通道，立即返回（0 延迟，无需确认）
    if (kind === 'system') {
      pendingRef.current = { text: '', count: 0 }
      setLastScanResult(trimmed)
      setLastScanKind('system')
      setScanNotice('')
      onScan(trimmed)
      stopScanning()
      onOpenChange(false)
      return
    }

    // 二维码：直接接受（qr-scanner 自身已有去重）
    if (kind === 'qr') {
      pendingRef.current = { text: '', count: 0 }
      setLastScanResult(trimmed)
      setLastScanKind('qr')
      setScanNotice('')
      onScan(trimmed)
      stopScanning()
      onOpenChange(false)
      return
    }

    // 通用条码：需连续 N 次相同结果才确认（防误读）
    const required = scanProfile.genericConfirmCount ?? 2
    if (required > 1) {
      const pending = pendingRef.current
      if (pending.text === trimmed) {
        pending.count += 1
      } else {
        pendingRef.current = { text: trimmed, count: 1 }
      }
      if (pendingRef.current.count < required) {
        setScanNotice(`已识别通用条码，正在确认 (${pendingRef.current.count}/${required})：${trimmed}`)
        return
      }
      // 达到确认次数，重置计数
      pendingRef.current = { text: '', count: 0 }
    }

    // 通用条码确认成功：短暂显示反馈后关闭
    setLastScanResult(trimmed)
    setLastScanKind('generic')
    setScanNotice('')
    const delay = scanProfile.genericCloseDelayMs ?? 500
    onScan(trimmed)
    closeTimerRef.current = setTimeout(() => {
      stopScanning()
      onOpenChange(false)
    }, delay)
  }, [activeMode, onScan, onOpenChange, scanProfile.genericConfirmCount, scanProfile.genericCloseDelayMs, scanProfile.mismatchMessage, stopScanning])

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
        // 优先使用浏览器原生 BarcodeDetector API（Chrome/Edge Android 81+）
        // 原生 API 解码速度比纯 JS ZXing 快 3-5 倍，通用条码准确率提升 30-40%
        // 不支持的浏览器（iOS Safari）会自动回退到 ZXing，行为与之前一致
        useBarCodeDetectorIfSupported: true,
      })
      html5Ref.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: scanProfile.html5Fps ?? 15,
          // 自适应扫描框：根据视频实际尺寸动态计算，避免小屏超出容器
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const w = Math.min(viewfinderWidth * 0.85, 320)
            const h = Math.min(viewfinderHeight * 0.6, 180)
            return { width: Math.floor(w), height: Math.floor(h) }
          },
          experimentalFeatures: {
            // 启用原生 BarcodeDetector（与构造参数双保险，确保生效）
            useBarCodeDetectorIfSupported: true,
          } as never,
        },
        (decodedText, decodedResult) => {
          // 判断是条形码还是二维码：任何非 QR_CODE 格式都视为条形码
          const format = decodedResult?.result?.format?.format
          const isBarcode = format !== undefined && format !== Html5QrcodeSupportedFormats.QR_CODE
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
      setLastScanKind(null)
      setScanNotice('')
      setError('')
      pendingRef.current = { text: '', count: 0 }
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
    setLastScanKind(null)
    setScanNotice('')
    setError('')
    pendingRef.current = { text: '', count: 0 }
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{scanProfile.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-1">
            {selectableModes.map((scanMode) => {
              const active = scanMode === activeMode
              const Icon = scanMode === 'qrcode' ? QrCode : scanMode === 'mixed' ? Package : ScanLine
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
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full">
                <X className="size-4 mr-2" />
                关闭
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
            <div className={`rounded-md p-3 text-sm ${
              lastScanKind === 'system' ? 'bg-green-50 text-green-700'
              : lastScanKind === 'generic' ? 'bg-blue-50 text-blue-700'
              : 'bg-green-50 text-green-700'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                {lastScanKind === 'system' && (
                  <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 gap-1">
                    <Zap className="size-3" />
                    系统条码·快速识别
                  </Badge>
                )}
                {lastScanKind === 'generic' && (
                  <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 gap-1">
                    <Package className="size-3" />
                    通用条码
                  </Badge>
                )}
                {lastScanKind === 'qr' && (
                  <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 gap-1">
                    <QrCode className="size-3" />
                    二维码
                  </Badge>
                )}
              </div>
              <div className="font-mono break-all">{lastScanResult}</div>
            </div>
          )}

          {scanNotice && !lastScanResult && (
            <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-700 break-all">
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
