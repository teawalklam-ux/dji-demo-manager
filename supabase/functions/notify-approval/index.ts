// 审批通知 Edge Function
// 在创建借用申请后，通过企业微信 Webhook 通知审批人
// 由 pg_cron 或前端在 create_borrow_request 后调用

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 从请求体获取借用申请ID（可选，不传则查所有待通知的审批）
    let requestId: string | null = null
    try {
      const body = await req.json()
      requestId = body.request_id || null
    } catch {
      // 无请求体，查所有未通知的审批
    }

    // 查询待发送企业微信通知的审批通知
    // 站内通知 (notification_type='push') 已在 create_borrow_request SQL 中插入
    // 需要找出哪些审批申请还没有发过企业微信通知（没有对应的 wecom 类型记录）
    let query = supabase
      .from('overdue_notifications')
      .select(`
        id,
        recipient_id,
        borrow_request_id,
        message,
        borrow_requests (
          id,
          request_number,
          borrow_type,
          expected_borrow_date,
          expected_return_date,
          purpose,
          requester_id,
          items (name, model, barcode),
          requester:profiles!borrow_requests_requester_id_fkey (display_name, email)
        ),
        recipient:profiles!overdue_notifications_recipient_id_fkey (display_name, email, role)
      `)
      .eq('notification_category', 'approval')
      .eq('notification_type', 'push')

    if (requestId) {
      query = query.eq('borrow_request_id', requestId)
    }

    const { data: pendingNotifications, error: fetchError } = await query.limit(100)

    if (fetchError) {
      throw new Error(`Failed to fetch pending notifications: ${fetchError.message}`)
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending approval notifications', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 查询已发送过企业微信的审批申请ID，用于去重
    const pendingRequestIds = [...new Set(pendingNotifications.map((n: any) => n.borrow_request_id))]
    const { data: wecomSentRecords } = await supabase
      .from('overdue_notifications')
      .select('borrow_request_id')
      .eq('notification_category', 'approval')
      .eq('notification_type', 'wecom')
      .in('borrow_request_id', pendingRequestIds)

    const wecomSentRequestIds = new Set((wecomSentRecords || []).map((r: any) => r.borrow_request_id))

    // 过滤掉已发送企业微信的申请
    const unsentNotifications = pendingNotifications.filter(
      (n: any) => !wecomSentRequestIds.has(n.borrow_request_id)
    )

    if (unsentNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'All approval notifications already sent via WeCom', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 按借用申请分组，避免重复发送
    const requestMap = new Map<string, any>()
    for (const n of unsentNotifications) {
      if (!requestMap.has(n.borrow_request_id)) {
        requestMap.set(n.borrow_request_id, {
          request: n.borrow_requests,
          recipients: [],
          notificationIds: [],
        })
      }
      const entry = requestMap.get(n.borrow_request_id)
      entry.recipients.push(n.recipient)
      entry.notificationIds.push(n.id)
    }

    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    let wecomSentCount = 0

    if (wecomUrl) {
      for (const [requestId, data] of requestMap) {
        const req = data.request
        const borrowTypeLabel = req.borrow_type === 'customer' ? '客户试用' :
          req.borrow_type === 'marketing' ? '营销演示' : req.borrow_type

        // 收集审批人名称
        const approverNames = data.recipients
          .map((r: any) => r.display_name || r.email || '未知')
          .join('、')

        const content = [
          `【新审批申请】`,
          `申请单号：${req.request_number}`,
          `申请人：${req.requester?.display_name || '未知'}`,
          `样机：${req.items?.name || '未知'}${req.items?.model ? ' (' + req.items.model + ')' : ''}`,
          `条码：${req.items?.barcode || '-'}`,
          `借用类型：${borrowTypeLabel}`,
          `借用日期：${req.expected_borrow_date} ~ ${req.expected_return_date}`,
          `用途：${req.purpose || '-'}`,
          `待审批人：${approverNames}`,
          ``,
          `请及时处理审批，谢谢！`,
        ].join('\n')

        try {
          const wecomResponse = await fetch(wecomUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              msgtype: 'text',
              text: {
                content,
                mentioned_mobile_list: [],
              },
            }),
          })
          const result = await wecomResponse.json()
          console.log(`WeCom notification sent for request ${requestId}:`, JSON.stringify(result))

          if (wecomResponse.ok) {
            wecomSentCount++
          }
        } catch (wecomError) {
          console.error(`WeCom notification failed for request ${requestId}:`, wecomError)
        }
      }
    } else {
      console.log('WECOM_WEBHOOK_URL not configured, skipping WeCom notification')
    }

    // 标记这些通知为已发送企业微信
    // 插入 wecom 类型的通知记录，既作为标记也作为记录
    const wecomNotifications: any[] = []
    for (const [reqId, data] of requestMap) {
      for (const recipient of data.recipients) {
        wecomNotifications.push({
          borrower_id: data.request?.requester_id || null,
          notification_type: 'wecom',
          notification_category: 'approval',
          recipient_id: recipient.id,
          borrow_request_id: reqId,
          message: `企业微信已通知：${data.request?.request_number || reqId}`,
          is_read: true, // wecom 通知不需要在站内标记未读
        })
      }
    }

    if (wecomNotifications.length > 0) {
      const { error: insertError } = await supabase
        .from('overdue_notifications')
        .insert(wecomNotifications)
      if (insertError) {
        console.error('Failed to insert wecom notification records:', insertError)
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Approval notifications processed',
        totalPendingCount: unsentNotifications.length,
        uniqueRequestCount: requestMap.size,
        wecomSentCount,
        skippedAlreadySent: pendingNotifications.length - unsentNotifications.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
