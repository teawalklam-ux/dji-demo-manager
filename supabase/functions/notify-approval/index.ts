// 审批通知 Edge Function
// 在创建借用申请后，通过企业微信 Webhook 通知审批人
// 由 pg_cron 或前端在 create_borrow_request 后调用

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { bearerToken, configuredList, isUuid } from '../_shared/request-security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: 'Supabase service environment is incomplete' }, 500)
    }
    const supabase = createClient(supabaseUrl, supabaseKey)

    const token = bearerToken(req)
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401)

    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    let requestId: string | null = null
    try {
      const body = await req.json()
      requestId = isUuid(body.request_id) ? body.request_id : null
    } catch {
      // 由下面的参数校验统一返回错误。
    }

    if (!requestId) {
      return jsonResponse({ error: 'A valid request_id is required' }, 400)
    }

    const [requestResult, profileResult, approvalResult] = await Promise.all([
      supabase
        .from('borrow_requests')
        .select('id, requester_id')
        .eq('id', requestId)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('role, status')
        .eq('id', authData.user.id)
        .maybeSingle(),
      supabase
        .from('approval_records')
        .select('id')
        .eq('request_id', requestId)
        .eq('approver_id', authData.user.id)
        .not('acted_at', 'is', null)
        .limit(1)
        .maybeSingle(),
    ])

    if (requestResult.error) throw new Error(`Failed to verify request access: ${requestResult.error.message}`)
    if (profileResult.error) throw new Error(`Failed to verify caller profile: ${profileResult.error.message}`)
    if (approvalResult.error) throw new Error(`Failed to verify caller approval: ${approvalResult.error.message}`)
    if (!requestResult.data) return jsonResponse({ error: 'Borrow request not found' }, 404)

    const callerProfile = profileResult.data
    const callerIsActive = callerProfile?.status === 'active'
    const callerIsAdmin = ['super_admin', 'admin'].includes(callerProfile?.role || '')
    const callerIsRequester = requestResult.data.requester_id === authData.user.id
    const callerActedOnRequest = Boolean(approvalResult.data)

    if (!callerIsActive || (!callerIsAdmin && !callerIsRequester && !callerActedOnRequest)) {
      return jsonResponse({ error: 'Forbidden' }, 403)
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
          customer_name,
          requester_id,
          items (name, model, barcode),
          request_items (
            items (name, model, barcode)
          ),
          requester:profiles!borrow_requests_requester_id_fkey (display_name, email, phone)
        ),
        recipient:profiles!overdue_notifications_recipient_id_fkey (display_name, email, phone, role)
      `)
      .eq('notification_category', 'approval')
      .eq('notification_type', 'push')

    query = query.eq('borrow_request_id', requestId)

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

    // 查询已发送过企业微信的记录，用于去重
    // 去重维度：borrow_request_id + recipient_id（同一申请在不同审批步骤给不同审批人推送，每人只收1次）
    const pendingRequestIds = [...new Set(pendingNotifications.map((n) => n.borrow_request_id))]
    const { data: wecomSentRecords } = await supabase
      .from('overdue_notifications')
      .select('borrow_request_id, recipient_id')
      .eq('notification_category', 'approval')
      .eq('notification_type', 'wecom')
      .in('borrow_request_id', pendingRequestIds)

    // 构建 "request_id:recipient_id" 去重集合
    const wecomSentKeys = new Set(
      (wecomSentRecords || []).map((r) => `${r.borrow_request_id}:${r.recipient_id}`)
    )

    // 过滤掉已发送企业微信的申请+收件人组合
    const unsentNotifications = pendingNotifications.filter(
      (n) => !wecomSentKeys.has(`${n.borrow_request_id}:${n.recipient_id}`)
    )

    if (unsentNotifications.length === 0) {
      return new Response(
        JSON.stringify({ message: 'All approval notifications already sent via WeCom', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 每条通知单独处理：区分"待审批提醒"（发给审批人）和"审批通过/拒绝通知"（发给申请人）
    // recipient_id == requester_id → 审批结果通知（申请人收）
    // recipient_id != requester_id → 待审批提醒（审批人收，待审批人只显示自己）
    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    const approvalCcMobiles = configuredList('APPROVAL_CC_MOBILES')
    let wecomSentCount = 0
    const deliveredNotifications: typeof unsentNotifications = []

    const requiresApprovalCc = unsentNotifications.some((notification) => (
      notification.recipient_id === notification.borrow_requests?.requester_id
      && !(notification.message || '').includes('审批拒绝')
    ))
    if (requiresApprovalCc && approvalCcMobiles.length === 0) {
      return jsonResponse({ error: 'APPROVAL_CC_MOBILES is not configured' }, 500)
    }

    if (wecomUrl) {
      for (const n of unsentNotifications) {
        const req = n.borrow_requests
        const recipient = n.recipient
        const requestId = n.borrow_request_id

        if (!req || !recipient) continue

        const borrowTypeLabel = req.borrow_type === 'customer' ? '客户试用' :
          req.borrow_type === 'marketing' ? '营销演示' :
          req.borrow_type === 'transfer' ? '转借' : req.borrow_type

        const requestItems = (req.request_items || [])
          .map((line) => line.items)
          .filter(Boolean)
        const itemSummary = requestItems.length > 0
          ? requestItems.map((item) => (
              `${item.name || '未知'}${item.model ? ` (${item.model})` : ''}${item.barcode ? ` [${item.barcode}]` : ''}`
            )).join('、')
          : `${req.items?.name || '未知'}${req.items?.model ? ` (${req.items.model})` : ''}${req.items?.barcode ? ` [${req.items.barcode}]` : ''}`

        const recipientName = recipient.display_name || recipient.email || '未知'
        const requesterName = req.requester?.display_name || '未知'
        const recipientMobile = recipient.phone?.trim() || null
        const requesterMobile = req.requester?.phone?.trim() || null
        const isApprover = n.recipient_id !== req.requester_id
        const isRejected = !isApprover && (n.message || '').includes('审批拒绝')

        let content: string
        if (isApprover) {
          // 待审批提醒：发给审批人，"待审批人"只显示该审批人自己
          content = [
            `【新审批申请】`,
            `申请单号：${req.request_number}`,
            `申请人：${requesterName}`,
            `样机：${itemSummary}`,
            `借用类型：${borrowTypeLabel}`,
            ...(['customer', 'transfer'].includes(req.borrow_type) && req.customer_name
              ? [`客户：${req.customer_name}`]
              : []),
            `借用日期：${req.expected_borrow_date} ~ ${req.expected_return_date}`,
            `用途：${req.purpose || '-'}`,
            `待审批人：${recipientName}`,
            ``,
            `请及时处理审批，谢谢！`,
          ].join('\n')
        } else {
          // 审批结果通知：发给申请人
          // 根据消息内容判断是"通过"还是"拒绝"
          const title = isRejected ? '【审批拒绝】' : '【审批通过】'
          content = [
            title,
            `申请单号：${req.request_number}`,
            `申请人：${requesterName}`,
            `样机：${itemSummary}`,
            `借用类型：${borrowTypeLabel}`,
            ...(['customer', 'transfer'].includes(req.borrow_type) && req.customer_name
              ? [`客户：${req.customer_name}`]
              : []),
            `借用日期：${req.expected_borrow_date} ~ ${req.expected_return_date}`,
            isRejected
              ? `您的申请已被拒绝，请查看详情`
              : req.borrow_type === 'transfer'
                ? `转借已生效，设备当前借用关系已变更至您名下`
                : `您的申请已全部审批通过，请前往领取样机`,
          ].join('\n')
        }

        try {
          const wecomResponse = await fetch(wecomUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              msgtype: 'text',
              text: {
                content,
                // 企业微信会为手机号列表生成真正生效的 @；正文中的姓名保持纯文本，
                // 避免重复 @ 或把未通知的人误写成 @。
                mentioned_mobile_list: isApprover
                  ? (recipientMobile ? [recipientMobile] : [])
                  : isRejected
                    ? (recipientMobile ? [recipientMobile] : [])
                    : [
                        ...new Set(
                          [requesterMobile, ...approvalCcMobiles].filter(
                            (mobile): mobile is string => Boolean(mobile)
                          )
                        ),
                      ],
              },
            }),
          })
          const result = await wecomResponse.json()
          console.log(`WeCom notification sent for request ${requestId} to ${recipientName}:`, JSON.stringify(result))

          if (wecomResponse.ok && result.errcode === 0) {
            wecomSentCount++
            deliveredNotifications.push(n)
          } else {
            console.error(`WeCom rejected notification for request ${requestId}:`, JSON.stringify(result))
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
    const wecomNotifications: Array<{
      borrower_id: string | null
      notification_type: 'wecom'
      notification_category: 'approval'
      recipient_id: string
      borrow_request_id: string
      message: string
      is_read: true
    }> = []
    for (const n of deliveredNotifications) {
      wecomNotifications.push({
        borrower_id: n.borrow_requests?.requester_id || null,
        notification_type: 'wecom',
        notification_category: 'approval',
        recipient_id: n.recipient_id,
        borrow_request_id: n.borrow_request_id,
        message: `企业微信已通知：${n.borrow_requests?.request_number || n.borrow_request_id}`,
        is_read: true,
      })
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
        uniqueRequestCount: new Set(unsentNotifications.map((n) => n.borrow_request_id)).size,
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
