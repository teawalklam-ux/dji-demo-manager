import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, FileSearch, HardDrive, ImageOff, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { borrowService } from '@/services/borrow.service'
import { supabase } from '@/lib/supabase'
import type { NasArchiveSearchResult } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface NasArchiveSearchProps {
  mode: 'mine' | 'admin'
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function formatBytes(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`
  return `${value} B`
}

function ArchivePhotoDialog({
  result,
  onOpenChange,
}: {
  result: NasArchiveSearchResult | null
  onOpenChange: (open: boolean) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setUrl(null)
      setError(null)
      return
    }

    setUrl(null)
    setError(null)

    const controller = new AbortController()
    const photoUrl = result.photo_url
    let objectUrl: string | null = null
    async function load() {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session) throw new Error('登录状态已失效')
        const response = await fetch(photoUrl, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`NAS 返回 HTTP ${response.status}`)
        objectUrl = URL.createObjectURL(await response.blob())
        setUrl(objectUrl)
      } catch (loadError) {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : '归档照片加载失败')
      }
    }
    void load()

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [result])

  return (
    <Dialog open={Boolean(result)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle>{result?.request_number || 'NAS 归档照片'}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-72 items-center justify-center bg-muted p-4 sm:p-6">
          {url ? (
            <img
              src={url}
              alt={`${result?.item_name || '样机'}归还水印照片`}
              className="max-h-[68dvh] w-auto max-w-full object-contain"
            />
          ) : error ? (
            <div className="max-w-sm text-center text-sm text-muted-foreground">
              <ImageOff className="mx-auto mb-3 size-7" aria-hidden="true" />
              <p className="font-medium text-foreground">无法读取 NAS 归档照片</p>
              <p className="mt-1">{error}</p>
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              <LoaderCircle className="mx-auto mb-3 size-7 animate-spin" aria-hidden="true" />
              正在校验并读取内网归档
            </div>
          )}
        </div>
        {result && (
          <div className="grid gap-2 px-5 pb-5 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">机型：</span>{result.item_model || '-'}</p>
            <p><span className="text-muted-foreground">SN：</span>{result.serial_number_last4 ? `****${result.serial_number_last4}` : '-'}</p>
            <p><span className="text-muted-foreground">拍摄时间：</span>{formatDateTime(result.captured_at)}</p>
            <p><span className="text-muted-foreground">文件大小：</span>{formatBytes(result.size_bytes)}</p>
            <p className="break-all sm:col-span-2">
              <span className="text-muted-foreground">Supabase 导回路径：</span>
              {result.source_bucket_id}/{result.source_storage_path}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function NasArchiveSearch({ mode }: NasArchiveSearchProps) {
  const navigate = useNavigate()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [requestNumber, setRequestNumber] = useState('')
  const [itemModel, setItemModel] = useState('')
  const [serialLast4, setSerialLast4] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState<NasArchiveSearchResult[]>([])
  const [selected, setSelected] = useState<NasArchiveSearchResult | null>(null)

  useEffect(() => {
    let active = true
    borrowService.getNasArchiveViewerBaseUrl()
      .then((url) => {
        if (active) setConfigured(Boolean(url))
      })
      .catch(() => {
        if (active) setConfigured(false)
      })
    return () => {
      active = false
    }
  }, [])

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    try {
      const data = await borrowService.searchNasArchives({
        request_number: requestNumber,
        item_model: itemModel,
        serial_number_last4: serialLast4,
      })
      setResults(data)
      setSearched(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'NAS 归档查询失败'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const openRequest = (requestId: string) => {
    navigate(mode === 'admin'
      ? `/admin/request-history/${requestId}`
      : `/borrow/requests/${requestId}`)
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-xs">
      <div className="flex items-start gap-3 border-b p-4 sm:p-5">
        <span className="hm-empty-state__icon shrink-0">
          <HardDrive className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">NAS 归还照片快速查询</h2>
            {configured === true && (
              <Badge variant="outline" className="gap-1 text-success">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                内网鉴权
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            按申请号、机型或 SN 后四位查找归还照片；结果仍受当前账号权限限制。
          </p>
        </div>
      </div>

      <form className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[1fr_1fr_10rem_auto] lg:items-end" onSubmit={handleSearch}>
        <div>
          <label htmlFor={`nas-request-number-${mode}`} className="mb-1.5 block text-sm font-medium">申请号</label>
          <Input
            id={`nas-request-number-${mode}`}
            value={requestNumber}
            onChange={(event) => setRequestNumber(event.target.value)}
            placeholder="BR-20260824-001"
            disabled={configured !== true || loading}
          />
        </div>
        <div>
          <label htmlFor={`nas-item-model-${mode}`} className="mb-1.5 block text-sm font-medium">机型</label>
          <Input
            id={`nas-item-model-${mode}`}
            value={itemModel}
            onChange={(event) => setItemModel(event.target.value)}
            placeholder="如 DJI Air 3S"
            disabled={configured !== true || loading}
          />
        </div>
        <div>
          <label htmlFor={`nas-sn-last4-${mode}`} className="mb-1.5 block text-sm font-medium">SN 后四位</label>
          <Input
            id={`nas-sn-last4-${mode}`}
            value={serialLast4}
            onChange={(event) => setSerialLast4(event.target.value.toUpperCase())}
            placeholder="A1B2"
            maxLength={4}
            className="font-mono uppercase"
            disabled={configured !== true || loading}
          />
        </div>
        <Button type="submit" disabled={configured !== true || loading}>
          {loading ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
          查询归档
        </Button>
      </form>

      {configured === false && (
        <div className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">
          NAS 归档网关尚未启用；完成内网证书和首次同步验收后，这里会自动开放。
        </div>
      )}

      {searched && (
        <div className="border-t p-4 sm:p-5">
          {results.length === 0 ? (
            <div className="flex min-h-24 items-start gap-3 rounded-[var(--radius-card)] border border-dashed p-4 text-sm text-muted-foreground">
              <FileSearch className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">没有找到有权查看的归档照片</p>
                <p className="mt-1">请检查标签，或确认对应申请已完成照片归档。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">找到 {results.length} 张归档照片</p>
              {results.map((result) => (
                <article key={result.return_photo_id} className="grid gap-3 rounded-[var(--radius-card)] border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold">{result.request_number}</p>
                      <Badge variant="outline">{result.item_model || result.item_name}</Badge>
                      {result.serial_number_last4 && <Badge variant="secondary">SN ****{result.serial_number_last4}</Badge>}
                    </div>
                    <p className="mt-2 text-sm">{result.item_name}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{result.archive_path}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      可导回 Supabase：{result.source_bucket_id}/{result.source_storage_path}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      拍摄 {formatDateTime(result.captured_at)} · {formatBytes(result.size_bytes)} · SHA-256 已校验
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button size="sm" variant="outline" onClick={() => openRequest(result.request_id)}>
                      <Eye className="mr-1 size-4" />
                      申请详情
                    </Button>
                    <Button size="sm" onClick={() => setSelected(result)}>
                      查看照片
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <ArchivePhotoDialog result={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </section>
  )
}
