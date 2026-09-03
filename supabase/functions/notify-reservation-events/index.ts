import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { bearerToken, constantTimeEqual } from '../_shared/request-security.ts'

type ReservationEvent = {
  id: string
  event_type: 'overdue_risk' | 'auto_invalidated'
  borrow_request_id: string
  reservation_requester_id: string
  overdue_borrower_id: string | null
  final_approver_id: string | null
  event_date: string
  item_summary: string
  message: string
  attempt_count: number
}

type Profile = {
  id: string
  display_name: string | null
  email: string | null
  phone: string | null
}

const jsonHeaders = { 'Content-Type': 'application/json' }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function nextAttemptDate(attemptCount: number) {
  const delayMinutes = Math.min(2 ** Math.max(attemptCount, 0), 60)
  return new Date(Date.now() + delayMinutes * 60_000).toISOString()
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const cronSecret = Deno.env.get('RESERVATION_EVENTS_CRON_SECRET') || ''
  if (!cronSecret) {
    return jsonResponse({ error: 'Reservation notification authentication is not configured' }, 500)
  }
  if (!constantTimeEqual(bearerToken(request), cronSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')

  if (!supabaseUrl || !serviceRoleKey || !wecomUrl) {
    return jsonResponse({ error: 'Reservation notification environment is incomplete' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const now = new Date().toISOString()
  const { data: candidates, error: candidateError } = await supabase
    .from('reservation_events')
    .select(`
      id,
      event_type,
      borrow_request_id,
      reservation_requester_id,
      overdue_borrower_id,
      final_approver_id,
      event_date,
      item_summary,
      message,
      attempt_count
    `)
    .in('wecom_status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .lt('attempt_count', 5)
    .order('created_at')
    .limit(50)

  if (candidateError) {
    return jsonResponse({ error: candidateError.message }, 500)
  }

  let sent = 0
  let partial = 0
  let failed = 0

  for (const candidate of (candidates || []) as ReservationEvent[]) {
    const attemptCount = candidate.attempt_count + 1
    const { data: claimed, error: claimError } = await supabase
      .from('reservation_events')
      .update({
        wecom_status: 'processing',
        attempt_count: attemptCount,
        last_attempt_at: now,
        updated_at: now,
      })
      .eq('id', candidate.id)
      .in('wecom_status', ['pending', 'failed'])
      .select('id')
      .maybeSingle()

    if (claimError || !claimed) continue

    try {
      const participantIds = candidate.event_type === 'overdue_risk'
        ? [candidate.overdue_borrower_id, candidate.reservation_requester_id]
        : [candidate.final_approver_id, candidate.reservation_requester_id]
      const uniqueParticipantIds = [...new Set(participantIds.filter((id): id is string => Boolean(id)))]

      const [{ data: borrowRequest, error: requestError }, { data: profiles, error: profileError }] = await Promise.all([
        supabase
          .from('borrow_requests')
          .select('request_number, expected_borrow_date, expected_return_date')
          .eq('id', candidate.borrow_request_id)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('id, display_name, email, phone')
          .in('id', uniqueParticipantIds),
      ])

      if (requestError || !borrowRequest) {
        throw new Error(requestError?.message || 'Borrow request not found')
      }
      if (profileError) throw new Error(profileError.message)

      const profileById = new Map((profiles || []).map((profile: Profile) => [profile.id, profile]))
      const participantProfiles = uniqueParticipantIds
        .map((id) => profileById.get(id))
        .filter((profile): profile is Profile => Boolean(profile))
      const mentionedMobiles = [
        ...new Set(
          participantProfiles
            .map((profile) => profile.phone?.trim())
            .filter((phone): phone is string => Boolean(phone))
        ),
      ]
      const missingMentionNames = participantProfiles
        .filter((profile) => !profile.phone?.trim())
        .map((profile) => profile.display_name || profile.email || profile.id)

      const title = candidate.event_type === 'overdue_risk'
        ? '【预约样机逾期风险】'
        : '【预约自动失效】'
      const participantLabel = candidate.event_type === 'overdue_risk'
        ? '已 @ 当前逾期借用人及预约申请人'
        : '已 @ 最终审批人及预约申请人'
      const content = [
        title,
        `申请单号：${borrowRequest.request_number}`,
        `样机：${candidate.item_summary}`,
        `预约日期：${borrowRequest.expected_borrow_date} ~ ${borrowRequest.expected_return_date}`,
        candidate.message,
        participantLabel,
        ...(missingMentionNames.length > 0
          ? [`以下人员缺少手机号，无法产生有效 @：${missingMentionNames.join('、')}`]
          : []),
      ].join('\n')

      if (mentionedMobiles.length === 0) {
        throw new Error('All intended WeCom recipients are missing mobile numbers')
      }

      const wecomResponse = await fetch(wecomUrl, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          msgtype: 'text',
          text: {
            content,
            mentioned_mobile_list: mentionedMobiles,
          },
        }),
      })
      const wecomResult = await wecomResponse.json()

      if (!wecomResponse.ok || wecomResult.errcode !== 0) {
        throw new Error(`WeCom rejected event: ${JSON.stringify(wecomResult)}`)
      }

      const deliveryStatus = missingMentionNames.length > 0 ? 'partial' : 'sent'
      const { error: deliveryError } = await supabase
        .from('reservation_events')
        .update({
          wecom_status: deliveryStatus,
          delivered_at: new Date().toISOString(),
          last_error: missingMentionNames.length > 0
            ? `Missing mobile numbers: ${missingMentionNames.join('、')}`
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)

      if (deliveryError) throw new Error(deliveryError.message)
      if (deliveryStatus === 'partial') partial++
      else sent++
    } catch (error) {
      failed++
      const errorMessage = error instanceof Error ? error.message : String(error)
      await supabase
        .from('reservation_events')
        .update({
          wecom_status: 'failed',
          next_attempt_at: nextAttemptDate(attemptCount),
          last_error: errorMessage.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
    }
  }

  return jsonResponse({
    processed: sent + partial + failed,
    sent,
    partial,
    failed,
  })
})
