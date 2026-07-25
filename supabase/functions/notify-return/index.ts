// 样机归还企业微信通知
// 由前端在 process_return 成功后调用，通知林芷因和田潇。

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RETURN_MENTION_NAMES = ['林芷因', '田潇']

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let claimedRecordId: string | null = null

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    const supabase = createClient(supabaseUrl, supabaseKey)

    if (!wecomUrl) {
      return jsonResponse({ error: 'WECOM_WEBHOOK_URL is not configured' }, 500)
    }

    const authHeader = req.headers.get('authorization')
    const accessToken = authHeader?.replace(/^Bearer\s+/i, '')
    if (!accessToken) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
    if (authError || !authData.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    let recordId: string | null = null
    try {
      const body = await req.json()
      recordId = typeof body.borrow_record_id === 'string' ? body.borrow_record_id : null
    } catch {
      // 由下面的参数校验统一返回错误。
    }

    if (!recordId) {
      return jsonResponse({ error: 'borrow_record_id is required' }, 400)
    }

    const { data: record, error: recordError } = await supabase
      .from('borrow_records')
      .select(`
        id,
        request_id,
        borrower_id,
        return_date,
        status,
        notes,
        items (name, model, barcode)
      `)
      .eq('id', recordId)
      .maybeSingle()

    if (recordError) {
      throw new Error(`Failed to fetch borrow record: ${recordError.message}`)
    }
    if (!record) {
      return jsonResponse({ error: 'Borrow record not found' }, 404)
    }
    if (record.status !== 'returned') {
      return jsonResponse({ error: 'Borrow record has not been returned' }, 409)
    }

    if (record.borrower_id !== authData.user.id) {
      const { data: callerProfile, error: callerError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle()

      if (callerError) {
        throw new Error(`Failed to verify caller role: ${callerError.message}`)
      }
      if (!callerProfile || !['super_admin', 'admin'].includes(callerProfile.role)) {
        return jsonResponse({ error: 'Forbidden' }, 403)
      }
    }

    const { data: borrowRequest, error: requestError } = await supabase
      .from('borrow_requests')
      .select(`
        id,
        request_number,
        requester_id,
        requester:profiles!borrow_requests_requester_id_fkey (display_name)
      `)
      .eq('id', record.request_id)
      .maybeSingle()

    if (requestError) {
      throw new Error(`Failed to fetch borrow request: ${requestError.message}`)
    }
    if (!borrowRequest) {
      return jsonResponse({ error: 'Borrow request not found' }, 404)
    }

    const { data: recipients, error: recipientsError } = await supabase
      .from('profiles')
      .select('id, display_name, phone')
      .eq('status', 'active')
      .in('display_name', RETURN_MENTION_NAMES)

    if (recipientsError) {
      throw new Error(`Failed to fetch WeCom recipients: ${recipientsError.message}`)
    }

    const mentionedMobiles = [
      ...new Set(
        (recipients || [])
          .map((recipient) => recipient.phone?.trim())
          .filter((mobile): mobile is string => Boolean(mobile))
      ),
    ]

    if (mentionedMobiles.length === 0) {
      return jsonResponse({ error: 'No active return notification recipient has a mobile number' }, 422)
    }

    const { error: claimError } = await supabase
      .from('overdue_notifications')
      .insert({
        borrow_record_id: record.id,
        borrower_id: record.borrower_id,
        notification_type: 'wecom',
        notification_category: 'return',
        recipient_id: null,
        borrow_request_id: borrowRequest.id,
        message: `企业微信归还通知发送中：${borrowRequest.request_number}`,
        is_read: true,
      })

    if (claimError?.code === '23505') {
      return jsonResponse({
        message: 'Return notification already processed',
        alreadySent: true,
      })
    }
    if (claimError) {
      throw new Error(`Failed to claim return notification: ${claimError.message}`)
    }
    claimedRecordId = record.id

    const requesterName = borrowRequest.requester?.display_name || '未知'
    const itemName = record.items?.name || '未知'
    const itemModel = record.items?.model ? ` (${record.items.model})` : ''
    const content = [
      '【样机归还通知】',
      `申请单号：${borrowRequest.request_number}`,
      `借出申请人：${requesterName}`,
      `样机：${itemName}${itemModel}`,
      `条码：${record.items?.barcode || '-'}`,
      `归还日期：${record.return_date || '-'}`,
      `归还备注：${record.notes || '-'}`,
    ].join('\n')

    const wecomResponse = await fetch(wecomUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content,
          // 企业微信会根据手机号生成真正生效的 @，正文不手工拼接 @姓名。
          mentioned_mobile_list: mentionedMobiles,
        },
      }),
    })
    const wecomResult = await wecomResponse.json()

    if (!wecomResponse.ok || wecomResult.errcode !== 0) {
      await supabase
        .from('overdue_notifications')
        .delete()
        .eq('borrow_record_id', record.id)
        .eq('notification_category', 'return')
        .eq('notification_type', 'wecom')
      claimedRecordId = null
      throw new Error(`WeCom rejected return notification: ${JSON.stringify(wecomResult)}`)
    }

    const { error: markerError } = await supabase
      .from('overdue_notifications')
      .update({
        message: `企业微信已通知归还：${borrowRequest.request_number} / ${itemName}`,
      })
      .eq('borrow_record_id', record.id)
      .eq('notification_category', 'return')
      .eq('notification_type', 'wecom')

    if (markerError) {
      console.error('Failed to update return notification marker:', markerError)
    }

    claimedRecordId = null
    return jsonResponse({
      message: 'Return notification delivered',
      wecomSentCount: 1,
      mentionedRecipientCount: mentionedMobiles.length,
    })
  } catch (error) {
    if (claimedRecordId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)
        await supabase
          .from('overdue_notifications')
          .delete()
          .eq('borrow_record_id', claimedRecordId)
          .eq('notification_category', 'return')
          .eq('notification_type', 'wecom')
      } catch (cleanupError) {
        console.error('Failed to release return notification claim:', cleanupError)
      }
    }

    console.error('Return notification failed:', error)
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500
    )
  }
})
