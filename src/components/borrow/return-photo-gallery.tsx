/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V5 */
import { useEffect, useState } from 'react'
import type { ReturnPhotoView } from '@/types'
import { Camera, CheckCircle2, Clock3, HardDrive, ImageOff, LoaderCircle, MapPin } from 'lucide-react'

import { supabase } from '@/lib/supabase'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface ReturnPhotoGalleryProps {
  photos: ReturnPhotoView[]
  hasCompletedReturn: boolean
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function getLocationLabel(photo: ReturnPhotoView) {
  if (photo.address) return photo.address
  if (photo.latitude !== null && photo.longitude !== null) {
    return `${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`
  }
  return '未记录定位信息'
}

function PhotoMetadata({ photo }: { photo: ReturnPhotoView }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{formatDateTime(photo.captured_at)}</span>
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 break-words">{getLocationLabel(photo)}</span>
      </div>
    </div>
  )
}

function useArchivedPhoto(photo: ReturnPhotoView) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shouldLoad = !photo.signed_url && Boolean(photo.nas_url)

  useEffect(() => {
    if (!shouldLoad || !photo.nas_url) {
      setUrl(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    let objectUrl: string | null = null

    async function load() {
      try {
        setError(null)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session) throw new Error('登录状态已失效')

        const response = await fetch(photo.nas_url!, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error(response.status === 404 ? '内网归档照片不存在或无权查看' : `NAS 返回 HTTP ${response.status}`)
        }

        objectUrl = URL.createObjectURL(await response.blob())
        setUrl(objectUrl)
      } catch (loadError) {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : 'NAS 归档照片加载失败')
      }
    }

    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.nas_url, shouldLoad])

  return { url, error, loading: shouldLoad && !url && !error }
}

function ReturnPhotoCard({ photo }: { photo: ReturnPhotoView }) {
  const itemName = photo.borrow_record?.item?.name || '归还样机'
  const itemModel = photo.borrow_record?.item?.model
  const archived = useArchivedPhoto(photo)
  const displayUrl = photo.signed_url || archived.url
  const archivedOnly = Boolean(photo.supabase_deleted_at)

  return (
    <figure className="min-w-0 overflow-hidden rounded-[var(--radius-card)] border bg-background">
      {displayUrl ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="block w-full overflow-hidden bg-muted text-left active:opacity-90"
              aria-label={`查看 ${itemName} 的归还水印照片`}
            >
              <img
                src={displayUrl}
                alt={`${itemName} 归还水印照片`}
                width={1600}
                height={1200}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto p-0">
            <DialogHeader className="border-b px-5 py-4 text-left">
              <DialogTitle>{itemName} · 归还水印照片</DialogTitle>
            </DialogHeader>
            <div className="bg-muted p-3 sm:p-5">
              <img
                src={displayUrl}
                alt={`${itemName} 归还水印照片大图`}
                width={2000}
                height={1500}
                className="mx-auto max-h-[65dvh] w-auto max-w-full object-contain"
              />
            </div>
            <div className="px-5 pb-5">
              <PhotoMetadata photo={photo} />
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-muted p-5 text-center">
          <div className="max-w-64 text-sm text-muted-foreground">
            {archived.loading ? (
              <LoaderCircle className="mx-auto mb-3 size-7 animate-spin" aria-hidden="true" />
            ) : (
              <ImageOff className="mx-auto mb-3 size-7" aria-hidden="true" />
            )}
            <p className="font-medium text-foreground">
              {archived.loading
                ? '正在从内网 NAS 读取'
                : photo.photo_deleted_at
                  ? '历史照片文件已被清理'
                  : archivedOnly
                    ? 'NAS 归档照片暂时无法加载'
                    : '照片暂时无法加载'}
            </p>
            <p className="mt-1">
              {photo.photo_deleted_at
                ? '该文件在永久保留策略启用前已被清理，拍摄信息仍会保留。'
                : archivedOnly
                  ? '请确认当前设备位于公司内网，并检查 NAS 归档服务。'
                  : '请刷新页面重试，或联系管理员检查存储权限。'}
            </p>
          </div>
        </div>
      )}
      <figcaption className="space-y-3 border-t p-4">
        <div>
          <p className="font-medium">{itemName}</p>
          {itemModel && <p className="mt-0.5 text-sm text-muted-foreground">{itemModel}</p>}
        </div>
        <PhotoMetadata photo={photo} />
        {photo.nas_archived_at && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {archivedOnly
              ? <HardDrive className="size-4 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />}
            <span>{archivedOnly ? '已转为 NAS 内网归档' : 'NAS 双重哈希校验已完成'}</span>
          </div>
        )}
        {(photo.load_error || archived.error) && (
          <p className="text-xs text-destructive" role="status">
            存储访问失败：{archived.error || photo.load_error}
          </p>
        )}
      </figcaption>
    </figure>
  )
}

export function ReturnPhotoGallery({ photos, hasCompletedReturn }: ReturnPhotoGalleryProps) {
  if (photos.length === 0) {
    return (
      <div className="flex min-h-32 items-start gap-3 rounded-[var(--radius-card)] border border-dashed p-4 text-sm text-muted-foreground">
        <Camera className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium text-foreground">暂无归还水印照片</p>
          <p className="mt-1">
            {hasCompletedReturn
              ? '该申请没有可显示的归还照片记录。'
              : '完成拍照归还后，照片与拍摄信息会显示在这里。'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
      {photos.map((photo) => <ReturnPhotoCard key={photo.id} photo={photo} />)}
    </div>
  )
}
