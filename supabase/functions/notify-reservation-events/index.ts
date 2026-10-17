import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { bearerToken, constantTimeEqual, isUuid } from '../_shared/request-security.ts'

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

type WorkerRequest = {
  action?: string
  notification_ids?: unknown
}

type WeComWebhookResponse = {
  errcode?: number
  errmsg?: string
}

type ApprovalNotificationCandidate = {
  id: string
  recipient_id: string
  borrow_request_id: string
  borrow_requests: {
    request_number: string
    requester_id: string
    status: string
    borrow_type: string
    expected_borrow_date: string
    expected_return_date: string
    purpose: string | null
    customer_name: string | null
    items: { name: string | null; model: string | null; barcode: string | null } | null
    request_items: Array<{
      items: { name: string | null; model: string | null; barcode: string | null } | null
    }>
    requester: { display_name: string | null; email: string | null } | null
  } | null
  recipient: {
    display_name: string | null
    email: string | null
    phone: string | null
  } | null
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

  const body = await request.json().catch(() => ({})) as WorkerRequest
  if (body.action === 'wecom_smoke_test') {
    if (!wecomUrl) {
      return jsonResponse({ error: 'WECOM_WEBHOOK_URL is not configured' }, 500)
    }

    const testId = crypto.randomUUID()
    const sentAt = new Date().toISOString()
    const wecomResponse = await fetch(wecomUrl, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: [
            '【系统测试｜企业微信 Webhook】',
            '用途：验证样机借用系统通知通道',
            '结果：若看到本消息，说明 Webhook 推送链路正常',
            `测试编号：${testId}`,
            `发送时间：${sentAt}`,
          ].join('\n'),
        },
      }),
    })

    const responseText = await wecomResponse.text()
    let wecomResult: WeComWebhookResponse
    try {
      wecomResult = JSON.parse(responseText) as WeComWebhookResponse
    } catch {
      return jsonResponse({
        error: 'WeCom returned a non-JSON response',
        providerStatus: wecomResponse.status,
        testId,
      }, 502)
    }

    if (!wecomResponse.ok || wecomResult.errcode !== 0) {
      return jsonResponse({
        error: 'WeCom rejected the smoke test',
        providerStatus: wecomResponse.status,
        errcode: wecomResult.errcode,
        errmsg: wecomResult.errmsg,
        testId,
      }, 502)
    }

    return jsonResponse({
      action: 'wecom_smoke_test',
      delivered: true,
      testId,
      sentAt,
    })
  }

  if (!supabaseUrl || !serviceRoleKey || !wecomUrl) {
    return jsonResponse({ error: 'Reservation notification environment is incomplete' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'resend_missed_approval_notifications') {
    const notificationIds = Array.isArray(body.notification_ids)
      ? [...new Set(body.notification_ids.filter(isUuid))]
      : []
    if (notificationIds.length === 0 || notificationIds.length > 20) {
      return jsonResponse({ error: 'Between 1 and 20 valid notification_ids are required' }, 400)
    }

    const { data, error: candidateError } = await supabase
      .from('overdue_notifications')
      .select(`
        id,
        recipient_id,
        borrow_request_id,
        borrow_requests (
          request_number,
          requester_id,
          status,
          borrow_type,
          expected_borrow_date,
          expected_return_date,
          purpose,
          customer_name,
          items (name, model, barcode),
          request_items:borrow_request_items (
            items (name, model, barcode)
          ),
          requester:profiles!borrow_requests_requester_id_fkey (display_name, email)
        ),
        recipient:profiles!overdue_notifications_recipient_id_fkey (display_name, email, phone)
      `)
      .eq('notification_category', 'approval')
      .eq('notification_type', 'push')
      .in('id', notificationIds)

    if (candidateError) return jsonResponse({ error: candidateError.message }, 500)
    const candidates = (data || []) as unknown as ApprovalNotificationCandidate[]
    const requestIds = [...new Set(candidates.map((candidate) => candidate.borrow_request_id))]
    const recipientIds = [...new Set(candidates.map((candidate) => candidate.recipient_id))]

    const [{ data: sentRecords, error: sentError }, { data: pendingApprovals, error: approvalError }] = await Promise.all([
      supabase
        .from('overdue_notifications')
        .select('borrow_request_id, recipient_id')
        .eq('notification_category', 'approval')
        .eq('notification_type', 'wecom')
        .in('borrow_request_id', requestIds),
      supabase
        .from('approval_records')
        .select('request_id, approver_id')
        .in('request_id', requestIds)
        .in('approver_id', recipientIds)
        .is('acted_at', null),
    ])
    if (sentError) return jsonResponse({ error: sentError.message }, 500)
    if (approvalError) return jsonResponse({ error: approvalError.message }, 500)

    const sentKeys = new Set(
      (sentRecords || []).map((record) => `${record.borrow_request_id}:${record.recipient_id}`),
    )
    const pendingKeys = new Set(
      (pendingApprovals || []).map((record) => `${record.request_id}:${record.approver_id}`),
    )
    const sent: string[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    const failed: Array<{ id: string; reason: string }> = []

    for (const candidate of candidates) {
      const deliveryKey = `${candidate.borrow_request_id}:${candidate.recipient_id}`
      const borrowRequest = candidate.borrow_requests
      const recipient = candidate.recipient
      if (sentKeys.has(deliveryKey)) {
        skipped.push({ id: candidate.id, reason: 'already_sent' })
        continue
      }
      if (
        !borrowRequest
        || !recipient
        || candidate.recipient_id === borrowRequest.requester_id
        || !['pending', 'partially_approved'].includes(borrowRequest.status)
        || !pendingKeys.has(deliveryKey)
      ) {
        skipped.push({ id: candidate.id, reason: 'no_longer_actionable' })
        continue
      }

      const requestItems = (borrowRequest.request_items || [])
        .map((line) => line.items)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
      const itemSummary = requestItems.length > 0
        ? requestItems.map((item) => (
            `${item.name || '未知'}${item.model ? ` (${item.model})` : ''}${item.barcode ? ` [${item.barcode}]` : ''}`
          )).join('、')
        : `${borrowRequest.items?.name || '未知'}${borrowRequest.items?.model ? ` (${borrowRequest.items.model})` : ''}${borrowRequest.items?.barcode ? ` [${borrowRequest.items.barcode}]` : ''}`
      const requesterName = borrowRequest.requester?.display_name || borrowRequest.requester?.email || '未知'
      const recipientName = recipient.display_name || recipient.email || '未知'
      const borrowTypeLabel = borrowRequest.borrow_type === 'customer' ? '客户试用'
        : borrowRequest.borrow_type === 'marketing' ? '营销演示'
        : borrowRequest.borrow_type === 'transfer' ? '转借'
        : borrowRequest.borrow_type
      const content = [
        '【审批提醒补发】',
        `申请单号：${borrowRequest.request_number}`,
        `申请人：${requesterName}`,
        `样机：${itemSummary}`,
        `借用类型：${borrowTypeLabel}`,
        ...(['customer', 'transfer'].includes(borrowRequest.borrow_type) && borrowRequest.customer_name
          ? [`客户：${borrowRequest.customer_name}`]
          : []),
        `借用日期：${borrowRequest.expected_borrow_date} ~ ${borrowRequest.expected_return_date}`,
        `用途：${borrowRequest.purpose || '-'}`,
        `当前待审批人：${recipientName}`,
        '',
        '说明：此前因系统故障未成功推送，当前仍待您审批，请及时处理。',
      ].join('\n')

      try {
        const wecomResponse = await fetch(wecomUrl, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            msgtype: 'text',
            text: {
              content,
              mentioned_mobile_list: recipient.phone?.trim() ? [recipient.phone.trim()] : [],
            },
          }),
        })
        const wecomResult = await wecomResponse.json() as WeComWebhookResponse
        if (!wecomResponse.ok || wecomResult.errcode !== 0) {
          failed.push({ id: candidate.id, reason: `wecom_${wecomResult.errcode ?? wecomResponse.status}` })
          continue
        }

        const { error: markerError } = await supabase
          .from('overdue_notifications')
          .insert({
            borrower_id: borrowRequest.requester_id,
            notification_type: 'wecom',
            notification_category: 'approval',
            recipient_id: candidate.recipient_id,
            borrow_request_id: candidate.borrow_request_id,
            message: `企业微信补发通知：${borrowRequest.request_number}`,
            is_read: true,
          })
        if (markerError) {
          failed.push({ id: candidate.id, reason: 'delivery_marker_failed' })
          continue
        }
        sent.push(candidate.id)
        sentKeys.add(deliveryKey)
      } catch {
        failed.push({ id: candidate.id, reason: 'delivery_exception' })
      }
    }

    return jsonResponse({
      action: 'resend_missed_approval_notifications',
      requested: notificationIds.length,
      sent,
      skipped,
      failed,
    }, failed.length > 0 ? 502 : 200)
  }

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
