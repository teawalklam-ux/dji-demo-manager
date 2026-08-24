import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.106.0'

export const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  })
}

export function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

export function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)

  for (let index = 0; index < length; index++) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  }

  return difference === 0
}

export async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

interface ArchiveEvent {
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  created_at: string
}

function humanBytes(value: unknown) {
  const bytes = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function eventTitle(eventType: string) {
  const titles: Record<string, string> = {
    sync_verified: 'NAS 归还照片同步校验成功',
    sync_failed: 'NAS 归还照片同步失败',
    cleanup_deleted: 'Supabase 归还照片已清理',
    cleanup_failed: 'Supabase 归还照片清理失败',
    storage_warning: 'Supabase Storage 容量预警',
    storage_critical: 'Supabase Storage 容量严重预警',
    database_warning: 'Supabase 数据库容量预警',
    database_critical: 'Supabase 数据库容量严重预警',
    unlinked_storage_objects: 'Supabase 归还照片孤儿文件预警',
  }
  return titles[eventType] || `归还照片归档事件：${eventType}`
}

function eventLines(event: ArchiveEvent) {
  const payload = event.payload || {}
  const lines = [`【${eventTitle(event.event_type)}】`]

  if (payload.return_photo_id) lines.push(`照片 ID：${payload.return_photo_id}`)
  if (payload.request_number) lines.push(`申请号：${payload.request_number}`)
  if (payload.item_model) lines.push(`机型：${payload.item_model}`)
  if (payload.serial_number_last4) lines.push(`SN 后四位：${payload.serial_number_last4}`)
  if (payload.nas_archive_path) lines.push(`NAS 路径：${payload.nas_archive_path}`)
  if (payload.source_bucket_id && payload.source_storage_path) {
    lines.push(`Supabase 导回路径：${payload.source_bucket_id}/${payload.source_storage_path}`)
  }
  if (payload.storage_path && payload.storage_path !== payload.source_storage_path) {
    lines.push(`Storage 路径：${payload.storage_path}`)
  }
  if (payload.size_bytes !== undefined) lines.push(`文件大小：${humanBytes(payload.size_bytes)}`)
  if (payload.total_bytes !== undefined && payload.quota_bytes !== undefined) {
    lines.push(`当前容量：${humanBytes(payload.total_bytes)} / ${humanBytes(payload.quota_bytes)}`)
  }
  if (payload.ratio !== undefined) {
    lines.push(`使用比例：${(Number(payload.ratio) * 100).toFixed(1)}%`)
  }
  if (payload.pending_archive_count !== undefined) {
    lines.push(`待同步任务：${payload.pending_archive_count}`)
  }
  if (payload.object_count !== undefined) {
    lines.push(`无业务记录文件数：${payload.object_count}`)
  }
  if (payload.total_bytes !== undefined && payload.quota_bytes === undefined) {
    lines.push(`无业务记录文件容量：${humanBytes(payload.total_bytes)}`)
  }
  if (payload.action === 'manual_review_required') {
    lines.push('处理要求：人工核查，系统不会自动删除')
  }
  if (payload.error) lines.push(`错误：${String(payload.error).slice(0, 800)}`)
  lines.push(`事件时间：${new Date(event.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
  return lines
}

function isWeComWebhook(url: string, configuredFormat: string) {
  if (configuredFormat === 'wecom') return true
  if (configuredFormat === 'generic') return false
  try {
    return new URL(url).hostname.toLowerCase() === 'qyapi.weixin.qq.com'
  } catch {
    return false
  }
}

async function postArchiveWebhook(event: ArchiveEvent, url: string, configuredFormat: string) {
  const weCom = isWeComWebhook(url, configuredFormat)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const genericBearer = Deno.env.get('RETURN_PHOTO_ARCHIVE_WEBHOOK_BEARER_TOKEN')
  if (!weCom && genericBearer) headers.Authorization = `Bearer ${genericBearer}`

  const body = weCom
    ? {
        msgtype: 'markdown',
        markdown: { content: eventLines(event).join('\n') },
      }
    : {
        source: 'dji-demo-manager',
        id: event.event_id,
        type: event.event_type,
        occurred_at: event.created_at,
        payload: event.payload,
      }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}: ${responseText.slice(0, 500)}`)
  }

  if (weCom) {
    let result: { errcode?: number; errmsg?: string }
    try {
      result = JSON.parse(responseText)
    } catch {
      throw new Error('WeCom webhook returned invalid JSON')
    }
    if (result.errcode !== 0) {
      throw new Error(`WeCom webhook rejected the event: ${result.errcode} ${result.errmsg || ''}`)
    }
  }
}

export async function deliverArchiveWebhookEvents(
  supabase: SupabaseClient,
  limit = 20,
) {
  const dedicatedWebhookUrl = Deno.env.get('RETURN_PHOTO_ARCHIVE_WEBHOOK_URL')
  const sharedWeComWebhookUrl = Deno.env.get('WECOM_WEBHOOK_URL')
  const webhookUrl = dedicatedWebhookUrl || sharedWeComWebhookUrl
  if (!webhookUrl) {
    return { processed: 0, delivered: 0, failed: 0, skipped: 'webhook-not-configured' }
  }
  const webhookFormat = dedicatedWebhookUrl
    ? (Deno.env.get('RETURN_PHOTO_ARCHIVE_WEBHOOK_FORMAT') || 'auto').toLowerCase()
    : 'wecom'

  const { data, error } = await supabase.rpc('claim_return_photo_archive_events', {
    p_limit: limit,
  })
  if (error) throw new Error(`Failed to claim archive webhook events: ${error.message}`)

  const events = (data || []) as ArchiveEvent[]
  let delivered = 0
  let failed = 0

  for (const event of events) {
    try {
      await postArchiveWebhook(event, webhookUrl, webhookFormat)
      const { error: completeError } = await supabase.rpc('complete_return_photo_archive_event', {
        p_event_id: event.event_id,
      })
      if (completeError) throw new Error(`Failed to complete webhook event: ${completeError.message}`)
      delivered++
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[return-photo-archive] Webhook event ${event.event_id} failed:`, message)
      const { error: failError } = await supabase.rpc('fail_return_photo_archive_event', {
        p_event_id: event.event_id,
        p_error: message,
      })
      if (failError) {
        console.error(`[return-photo-archive] Failed to release webhook event ${event.event_id}:`, failError)
      }
    }
  }

  return { processed: events.length, delivered, failed }
}
