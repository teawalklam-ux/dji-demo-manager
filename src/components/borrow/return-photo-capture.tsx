import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { drawWatermark } from '@/lib/photo-watermark'
import { getCurrentLocation, formatCoordinates } from '@/lib/geolocation'
import type { GeoLocation } from '@/lib/geolocation'
import { Camera, RotateCcw, Check, MapPin, Clock } from 'lucide-react'

export interface PhotoData {
  blob: Blob
  capturedAt: Date
  latitude: number | null
  longitude: number | null
  address: string | null
}

interface ReturnPhotoCaptureProps {
  onPhotoCaptured: (data: PhotoData) => void
  onPhotoCleared: () => void
}

export function ReturnPhotoCapture({ onPhotoCaptured, onPhotoCleared }: ReturnPhotoCaptureProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [photoData, setPhotoData] = useState<PhotoData | null>(null)
  const [geoLocation, setGeoLocation] = useState<GeoLocation | null>(null)
  const [locating, setLocating] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // 清理摄像头流
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }, [])

  // 打开摄像头
  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // 后置摄像头
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraActive(true)

      // 同时获取 GPS 位置（不阻塞拍照）
      setLocating(true)
      const loc = await getCurrentLocation()
      setGeoLocation(loc)
      setLocating(false)
    } catch (err: any) {
      console.error('[ReturnPhotoCapture] 摄像头错误:', err)
      if (err.name === 'NotAllowedError') {
        setCameraError('请允许使用摄像头权限后重试')
      } else if (err.name === 'NotFoundError') {
        setCameraError('未检测到摄像头设备')
      } else {
        setCameraError('摄像头启动失败: ' + (err.message || '未知错误'))
      }
    }
  }, [])

  // 拍照
  const handleCapture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 设置 canvas 尺寸与视频一致
    const width = video.videoWidth
    const height = video.videoHeight
    canvas.width = width
    canvas.height = height

    // 绘制视频帧
    ctx.drawImage(video, 0, 0, width, height)

    // 叠加水印
    const now = new Date()
    drawWatermark(canvas, {
      timestamp: now,
      latitude: geoLocation?.latitude ?? null,
      longitude: geoLocation?.longitude ?? null,
      address: geoLocation?.address,
    })

    // 导出为 JPEG blob
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('照片生成失败')
          return
        }

        const data: PhotoData = {
          blob,
          capturedAt: now,
          latitude: geoLocation?.latitude ?? null,
          longitude: geoLocation?.longitude ?? null,
          address: geoLocation?.address ?? null,
        }
        setPhotoData(data)

        // 生成预览 URL
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)

        // 关闭摄像头
        stopCamera()

        // 回调
        onPhotoCaptured(data)
      },
      'image/jpeg',
      0.85
    )
  }, [geoLocation, stopCamera, onPhotoCaptured])

  // 重拍
  const handleRetake = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    setPhotoData(null)
    setCameraError(null)
    onPhotoCleared()
    startCamera()
  }, [previewUrl, onPhotoCleared, startCamera])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopCamera()
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>归还拍照</CardTitle>
        <CardDescription>请使用设备摄像头拍摄归还样机的照片（不可从相册上传）</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 隐藏的 canvas 用于图像处理 */}
        <canvas ref={canvasRef} className="hidden" />

        {/* 照片预览 */}
        {previewUrl && photoData && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg border">
              <img
                src={previewUrl}
                alt="归还照片预览"
                className="w-full object-contain"
              />
            </div>
            {/* 元数据信息 */}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="size-4" />
                <span>
                  {photoData.capturedAt.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="size-4" />
                <span>
                  {photoData.latitude !== null && photoData.longitude !== null
                    ? formatCoordinates(photoData.latitude, photoData.longitude)
                    : 'GPS 不可用'}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleRetake}>
              <RotateCcw className="mr-2 size-4" />
              重新拍照
            </Button>
          </div>
        )}

        {/* 摄像头视图 */}
        {cameraActive && !previewUrl && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg border bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full object-contain"
              />
              {/* GPS 状态指示器 */}
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
                <MapPin className="size-3" />
                {locating ? '定位中...' : geoLocation ? '已定位' : 'GPS 不可用'}
              </div>
            </div>
            <Button onClick={handleCapture} className="w-full" size="lg">
              <Camera className="mr-2 size-5" />
              拍照
            </Button>
          </div>
        )}

        {/* 错误信息 */}
        {cameraError && !previewUrl && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {cameraError}
            </div>
            <Button variant="outline" onClick={startCamera} className="w-full">
              重试打开摄像头
            </Button>
          </div>
        )}

        {/* 初始状态：提示开始拍照 */}
        {!cameraActive && !previewUrl && !cameraError && (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8">
              <Camera className="size-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                点击下方按钮开启摄像头拍照
              </p>
              {locating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  正在获取位置信息...
                </div>
              )}
            </div>
            <Button onClick={startCamera} className="w-full" size="lg">
              <Camera className="mr-2 size-5" />
              开启摄像头
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
