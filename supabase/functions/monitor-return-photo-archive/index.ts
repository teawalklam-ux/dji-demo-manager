import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.0'

import {
  bearerToken,
  constantTimeEqual,
  deliverArchiveWebhookEvents,
  jsonResponse,
} from '../_shared/return-photo-archive.ts'

interface ArchiveConfig {
  storage_quota_bytes: number
  database_quota_bytes: number
  warning_ratio: number
  cleanup_trigger_ratio: number
  critical_ratio: number
  cleanup_enabled: boolean
}

interface Usage {
  total_storage_bytes: number
  return_photo_storage_bytes: number
  database_bytes: number
  pending_archive_count: number
  verified_archive_count: number
  unlinked_return_photo_object_count: number
  unlinked_return_photo_object_bytes: number
}

interface CleanupClaim {
  job_id: string
  lease_token: string
  return_photo_id: string
  source_bucket_id: string
  source_storage_path: string
  source_size_bytes: number
}

async function storageObjectExists(
  supabase: ReturnType<typeof createClient>,
  bucketId: string,
  storagePath: string,
) {
  const segments = storagePath.split('/').filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) throw new Error('Cleanup job has an invalid Storage path')
  const folder = segments.join('/')
  const { data, error } = await supabase.storage
    .from(bucketId)
    .list(folder, { search: fileName, limit: 100 })
  if (error) throw new Error(`Failed to verify Storage object presence: ${error.message}`)
  return (data || []).some((object) => object.name === fileName)
}

function localDateKey() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function addThresholdEvent(
  supabase: ReturnType<typeof createClient>,
  eventType: string,
  metric: string,
  totalBytes: number,
  quotaBytes: number,
  usage: Usage,
) {
  const ratio = quotaBytes > 0 ? totalBytes / quotaBytes : 0
  const { error } = await supabase
    .from('return_photo_archive_events')
    .upsert({
      event_type: eventType,
      dedupe_key: `${eventType}:${localDateKey()}`,
      payload: {
        metric,
        total_bytes: totalBytes,
        quota_bytes: quotaBytes,
        ratio,
        pending_archive_count: usage.pending_archive_count,
        verified_archive_count: usage.verified_archive_count,
      },
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (error) throw new Error(`Failed to enqueue ${metric} warning: ${error.message}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const configuredSecret = Deno.env.get('RETURN_PHOTO_ARCHIVE_CRON_SECRET') || ''
  if (!configuredSecret || !constantTimeEqual(bearerToken(req), configuredSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase service environment is incomplete')
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const [{ data: configData, error: configError }, { data: usageData, error: usageError }] = await Promise.all([
      supabase.from('return_photo_archive_config').select('*').eq('id', 1).single(),
      supabase.rpc('get_return_photo_archive_usage'),
    ])
    if (configError) throw new Error(`Failed to load archive config: ${configError.message}`)
    if (usageError) throw new Error(`Failed to calculate Supabase usage: ${usageError.message}`)

    const config = configData as ArchiveConfig
    const usage = (Array.isArray(usageData) ? usageData[0] : usageData) as Usage | undefined
    if (!usage) throw new Error('Usage query returned no data')

    const { data: lastSnapshot, error: lastSnapshotError } = await supabase
      .from('return_photo_storage_usage_snapshots')
      .select('captured_at')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastSnapshotError) throw new Error(`Failed to read usage snapshots: ${lastSnapshotError.message}`)
    const lastSnapshotAt = lastSnapshot?.captured_at ? new Date(lastSnapshot.captured_at).getTime() : 0
    if (!lastSnapshotAt || Date.now() - lastSnapshotAt >= 60 * 60 * 1000) {
      const { error: snapshotError } = await supabase
        .from('return_photo_storage_usage_snapshots')
        .insert({
          total_storage_bytes: usage.total_storage_bytes,
          return_photo_storage_bytes: usage.return_photo_storage_bytes,
          database_bytes: usage.database_bytes,
          pending_archive_count: usage.pending_archive_count,
          verified_archive_count: usage.verified_archive_count,
        })
      if (snapshotError) throw new Error(`Failed to save usage snapshot: ${snapshotError.message}`)
    }

    const storageRatio = usage.total_storage_bytes / config.storage_quota_bytes
    const databaseRatio = usage.database_bytes / config.database_quota_bytes

    if (storageRatio >= config.critical_ratio) {
      await addThresholdEvent(supabase, 'storage_critical', 'storage', usage.total_storage_bytes, config.storage_quota_bytes, usage)
    } else if (storageRatio >= config.warning_ratio) {
      await addThresholdEvent(supabase, 'storage_warning', 'storage', usage.total_storage_bytes, config.storage_quota_bytes, usage)
    }
    if (databaseRatio >= config.critical_ratio) {
      await addThresholdEvent(supabase, 'database_critical', 'database', usage.database_bytes, config.database_quota_bytes, usage)
    } else if (databaseRatio >= config.warning_ratio) {
      await addThresholdEvent(supabase, 'database_warning', 'database', usage.database_bytes, config.database_quota_bytes, usage)
    }

    const capacityEmergency = storageRatio >= config.cleanup_trigger_ratio
    if (config.cleanup_enabled && capacityEmergency) {
      const { error: cleanupNoticeError } = await supabase
        .from('return_photo_archive_events')
        .upsert({
          event_type: 'cleanup_planned',
          dedupe_key: `cleanup_planned:${localDateKey()}`,
          payload: {
            metric: 'storage',
            total_bytes: usage.total_storage_bytes,
            quota_bytes: config.storage_quota_bytes,
            ratio: storageRatio,
            target_ratio: config.warning_ratio,
            max_files_per_run: 100,
            notice_lead_minutes: 5,
            action: 'supabase_cleanup_planned',
          },
        }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      if (cleanupNoticeError) {
        throw new Error(`Failed to enqueue pre-cleanup notice: ${cleanupNoticeError.message}`)
      }
    }

    if (usage.unlinked_return_photo_object_count > 0) {
      console.warn(
        `[monitor-return-photo-archive] ${usage.unlinked_return_photo_object_count} unlinked Storage objects `
        + `(${usage.unlinked_return_photo_object_bytes} bytes) remain excluded from automatic cleanup`,
      )
    }

    // Only synchronization, capacity, and pre-cleanup notifications are
    // claimable. The database cleanup claim requires today's pre-cleanup
    // notice to have been delivered for at least five minutes.
    const preCleanupWebhook = await deliverArchiveWebhookEvents(supabase, 50)

    let estimatedStorageBytes = usage.total_storage_bytes
    let deleted = 0
    let deleteErrors = 0
    // Capacity is the only cleanup trigger. Below 80%, the monitor still
    // delivers Webhooks and records usage but never claims a delete job.
    const cleanupLimit = config.cleanup_enabled && capacityEmergency ? 100 : 0

    for (let index = 0; index < cleanupLimit; index++) {
      if (capacityEmergency && estimatedStorageBytes <= config.storage_quota_bytes * config.warning_ratio) break

      const { data: claims, error: claimError } = await supabase.rpc('claim_return_photo_cleanup_jobs', {
        p_worker_id: 'supabase-monitor',
        p_capacity_emergency: capacityEmergency,
        p_limit: 1,
        p_lease_minutes: 15,
      })
      if (claimError) throw new Error(`Failed to claim cleanup job: ${claimError.message}`)
      const claim = ((claims || []) as CleanupClaim[])[0]
      if (!claim) break

      const { error: removeError } = await supabase.storage
        .from(claim.source_bucket_id)
        .remove([claim.source_storage_path])
      try {
        if (await storageObjectExists(supabase, claim.source_bucket_id, claim.source_storage_path)) {
          throw new Error(removeError?.message || 'Storage API returned before the object disappeared')
        }
        // A previous invocation may have removed the object and then lost its
        // database response. An independently confirmed absence makes this
        // retry safe and idempotent even when remove() returned an error.
      } catch (presenceError) {
        deleteErrors++
        const message = presenceError instanceof Error ? presenceError.message : String(presenceError)
        const { error: failError } = await supabase.rpc('fail_return_photo_cleanup_job', {
          p_job_id: claim.job_id,
          p_lease_token: claim.lease_token,
          p_error: removeError ? `${removeError.message}; ${message}` : message,
        })
        if (failError) console.error(`[monitor-return-photo-archive] Failed to release cleanup ${claim.job_id}:`, failError)
        continue
      }

      const { error: completeError } = await supabase.rpc('complete_return_photo_cleanup_job', {
        p_job_id: claim.job_id,
        p_lease_token: claim.lease_token,
      })
      if (completeError) {
        deleteErrors++
        console.error(`[monitor-return-photo-archive] Storage removed but metadata finalization failed for ${claim.job_id}:`, completeError)
        continue
      }

      deleted++
      estimatedStorageBytes = Math.max(0, estimatedStorageBytes - Number(claim.source_size_bytes || 0))
    }

    const postCleanupWebhook = await deliverArchiveWebhookEvents(supabase, 50)
    return jsonResponse({
      usage,
      ratios: { storage: storageRatio, database: databaseRatio },
      cleanup: {
        enabled: config.cleanup_enabled,
        capacityEmergency,
        deleted,
        errors: deleteErrors,
      },
      webhook: { beforeCleanup: preCleanupWebhook, afterCleanup: postCleanupWebhook },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[monitor-return-photo-archive] Run failed:', message)
    return jsonResponse({ error: message }, 500)
  }
})
