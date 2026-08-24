import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.0'

import {
  bearerToken,
  constantTimeEqual,
  deliverArchiveWebhookEvents,
  jsonResponse,
  sha256Hex,
} from '../_shared/return-photo-archive.ts'

interface ArchiveClaim {
  job_id: string
  lease_token: string
  return_photo_id: string
  source_bucket_id: string
  source_storage_path: string
  captured_at: string
  suggested_archive_path: string
  borrow_record_id: string
  request_id: string
  request_number: string
  item_id: string
  item_name: string
  item_model: string
  serial_number_last4: string | null
}

interface CompleteBody {
  action: 'complete'
  job_id: string
  lease_token: string
  archive_path: string
  size_bytes: number
  sha256: string
}

function serviceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase service environment is incomplete')
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function failLease(
  supabase: ReturnType<typeof serviceClient>,
  jobId: string,
  leaseToken: string,
  message: string,
) {
  const { error } = await supabase.rpc('fail_return_photo_archive_job', {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_error: message,
  })
  if (error) console.error(`[nas-photo-archive] Failed to release lease ${jobId}:`, error)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const configuredToken = Deno.env.get('NAS_ARCHIVE_TOKEN') || ''
  if (!configuredToken || !constantTimeEqual(bearerToken(req), configuredToken)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const action = body.action
    const supabase = serviceClient()

    if (action === 'health') {
      return jsonResponse({ ok: true, service: 'nas-photo-archive' })
    }

    if (action === 'claim') {
      const workerId = typeof body.worker_id === 'string' ? body.worker_id.trim() : ''
      const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20)
      if (!workerId || workerId.length > 128) {
        return jsonResponse({ error: 'worker_id is required' }, 400)
      }

      const { data, error } = await supabase.rpc('claim_return_photo_archive_jobs', {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_minutes: 15,
      })
      if (error) throw new Error(`Failed to claim archive jobs: ${error.message}`)

      const jobs: Array<ArchiveClaim & { download_url: string }> = []
      for (const job of (data || []) as ArchiveClaim[]) {
        const { data: signed, error: signedError } = await supabase.storage
          .from(job.source_bucket_id)
          .createSignedUrl(job.source_storage_path, 15 * 60)
        if (signedError || !signed?.signedUrl) {
          await failLease(supabase, job.job_id, job.lease_token, signedError?.message || 'Failed to sign source object')
          continue
        }
        jobs.push({ ...job, download_url: signed.signedUrl })
      }

      return jsonResponse({ jobs })
    }

    if (action === 'fail') {
      if (!validUuid(body.job_id) || !validUuid(body.lease_token)) {
        return jsonResponse({ error: 'Valid job_id and lease_token are required' }, 400)
      }
      const message = typeof body.error === 'string' ? body.error : 'NAS agent reported an unknown failure'
      const { data, error } = await supabase.rpc('fail_return_photo_archive_job', {
        p_job_id: body.job_id,
        p_lease_token: body.lease_token,
        p_error: message,
      })
      if (error) return jsonResponse({ error: error.message }, 409)
      await deliverArchiveWebhookEvents(supabase, 10)
      return jsonResponse({ status: data })
    }

    if (action === 'complete') {
      const complete = body as unknown as CompleteBody
      if (!validUuid(complete.job_id) || !validUuid(complete.lease_token)) {
        return jsonResponse({ error: 'Valid job_id and lease_token are required' }, 400)
      }
      if (
        typeof complete.archive_path !== 'string'
        || complete.archive_path.length < 1
        || complete.archive_path.length > 1024
        || !Number.isSafeInteger(complete.size_bytes)
        || complete.size_bytes < 1
        || typeof complete.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/i.test(complete.sha256)
      ) {
        return jsonResponse({ error: 'Invalid archive verification payload' }, 400)
      }

      const { data: job, error: jobError } = await supabase
        .from('return_photo_archive_jobs')
        .select('id, return_photo_id, status, lease_token, source_bucket_id, source_storage_path, nas_archive_path, nas_size_bytes, nas_sha256')
        .eq('id', complete.job_id)
        .maybeSingle()
      if (jobError) throw new Error(`Failed to load archive job: ${jobError.message}`)
      if (!job) return jsonResponse({ error: 'Archive job not found' }, 404)
      if (
        ['verified', 'deleting', 'deleted'].includes(job.status)
        && job.nas_archive_path === complete.archive_path
        && Number(job.nas_size_bytes) === complete.size_bytes
        && job.nas_sha256 === complete.sha256.toLowerCase()
      ) {
        const webhook = await deliverArchiveWebhookEvents(supabase, 10)
        return jsonResponse({ status: job.status, return_photo_id: job.return_photo_id, idempotent: true, webhook })
      }
      if (job.status !== 'leased' || job.lease_token !== complete.lease_token) {
        return jsonResponse({ error: 'Archive lease is invalid or expired' }, 409)
      }

      try {
        const { data: sourceBlob, error: sourceError } = await supabase.storage
          .from(job.source_bucket_id)
          .download(job.source_storage_path)
        if (sourceError || !sourceBlob) {
          throw new Error(`Failed to download source for independent verification: ${sourceError?.message || 'missing object'}`)
        }
        const sourceBuffer = await sourceBlob.arrayBuffer()
        const sourceSha256 = await sha256Hex(sourceBuffer)

        const { data: photoId, error: verifyError } = await supabase.rpc('verify_return_photo_archive_job', {
          p_job_id: complete.job_id,
          p_lease_token: complete.lease_token,
          p_nas_archive_path: complete.archive_path,
          p_nas_size_bytes: complete.size_bytes,
          p_nas_sha256: complete.sha256.toLowerCase(),
          p_source_size_bytes: sourceBuffer.byteLength,
          p_source_sha256: sourceSha256,
        })
        if (verifyError) throw new Error(verifyError.message)

        const webhook = await deliverArchiveWebhookEvents(supabase, 10)
        return jsonResponse({ status: 'verified', return_photo_id: photoId, webhook })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await failLease(supabase, complete.job_id, complete.lease_token, message)
        await deliverArchiveWebhookEvents(supabase, 10)
        return jsonResponse({ error: message }, 422)
      }
    }

    return jsonResponse({ error: 'Unknown action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[nas-photo-archive] Request failed:', message)
    return jsonResponse({ error: message }, 500)
  }
})
