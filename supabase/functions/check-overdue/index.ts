import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 短借期阈值（天）：借出时间≤此值的标记为「短借逾期」，>此值的标记为「长借逾期」
const SHORT_BORROW_THRESHOLD_DAYS = 3

interface OverdueNotificationInsert {
  borrow_record_id: string
  borrower_id: string
  notification_type: 'push'
  message: string
  is_read: false
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify cron secret to prevent unauthorized calls
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const today = new Date().toISOString().split('T')[0]

    // ========================================
    // Part A: 新逾期 — status='active' 且 due_date < today
    // ========================================
    const { data: newOverdueRecords, error: fetchNewError } = await supabase
      .from('borrow_records')
      .select(`
        id,
        item_id,
        borrower_id,
        borrow_date,
        due_date,
        items (name, barcode),
        profiles:borrower_id (display_name, email, phone)
      `)
      .eq('status', 'active')
      .lt('due_date', today)

    if (fetchNewError) {
      throw new Error(`Failed to fetch new overdue records: ${fetchNewError.message}`)
    }

    // Update newly overdue records to 'overdue' status
    if (newOverdueRecords && newOverdueRecords.length > 0) {
      const newRecordIds = newOverdueRecords.map((r) => r.id)
      await supabase
        .from('borrow_records')
        .update({ status: 'overdue', updated_at: new Date().toISOString() })
        .in('id', newRecordIds)

      const newItemIds = [...new Set(newOverdueRecords.map((r) => r.item_id))]
      if (newItemIds.length > 0) {
        await supabase
          .from('items')
          .update({ status: 'overdue', updated_at: new Date().toISOString() })
          .in('id', newItemIds)
      }
    }

    // ========================================
    // Part B: 持续逾期 — status='overdue'（每日催还提醒）
    // ========================================
    const { data: existingOverdueRecords, error: fetchExistingError } = await supabase
      .from('borrow_records')
      .select(`
        id,
        item_id,
        borrower_id,
        borrow_date,
        due_date,
        items (name, barcode),
        profiles:borrower_id (display_name, email, phone)
      `)
      .eq('status', 'overdue')
      .lt('due_date', today)

    if (fetchExistingError) {
      throw new Error(`Failed to fetch existing overdue records: ${fetchExistingError.message}`)
    }

    // 合并所有逾期记录（新逾期 + 持续逾期）
    const allOverdueRecords = [
      ...(newOverdueRecords || []),
      ...(existingOverdueRecords || []),
    ]

    // 去重（按 id）
    const seenIds = new Set<string>()
    const uniqueRecords = allOverdueRecords.filter((r) => {
      if (seenIds.has(r.id)) return false
      seenIds.add(r.id)
      return true
    })

    if (uniqueRecords.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No overdue records found', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // Part C: 发送通知
    // ========================================
    const notifications: OverdueNotificationInsert[] = []
    const wecomItems: string[] = []
    const mentionedBorrowerMobiles = new Set<string>()

    for (const r of uniqueRecords) {
      const borrowDate = new Date(r.borrow_date)
      const dueDate = new Date(r.due_date)
      const borrowDays = Math.ceil((dueDate.getTime() - borrowDate.getTime()) / (1000 * 60 * 60 * 24))
      const overdueDays = Math.ceil((new Date(today).getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      const label = borrowDays <= SHORT_BORROW_THRESHOLD_DAYS ? '短借' : '长借'

      // 站内通知
      notifications.push({
        borrow_record_id: r.id,
        borrower_id: r.borrower_id,
        notification_type: 'push',
        message: overdueDays > 1
          ? `您借用的样机「${r.items?.name || '未知'}」已逾期 ${overdueDays} 天（应还 ${r.due_date}），请尽快归还。`
          : `您借用的样机「${r.items?.name || '未知'}」已逾期，预期归还日期为 ${r.due_date}，请尽快归还。`,
        is_read: false,
      })

      // 企业微信提醒
      const borrowerName = r.profiles?.display_name || r.profiles?.email || '未知用户'
      wecomItems.push(
        `- ${borrowerName}：「${r.items?.name || '未知'}」逾期 ${overdueDays} 天（${label}），应还 ${r.due_date}`
      )

      const borrowerMobile = r.profiles?.phone?.trim()
      if (borrowerMobile) {
        mentionedBorrowerMobiles.add(borrowerMobile)
      }
    }

    // Insert in-app notifications
    const { error: notifError } = await supabase
      .from('overdue_notifications')
      .insert(notifications)

    if (notifError) {
      console.error('Failed to insert notifications:', notifError)
    }

    // Send WeCom webhook notification
    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    if (wecomUrl && wecomItems.length > 0) {
      const overdueList = wecomItems.join('\n')

      try {
        const wecomResponse = await fetch(wecomUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'text',
            text: {
              content: [
                `【样机逾期提醒】`,
                `以下样机已逾期，请跟进处理：`,
                overdueList,
              ].join('\n'),
              // 企业微信会为手机号列表生成真正生效的 @，正文不再手工拼接 @姓名。
              mentioned_mobile_list: [...mentionedBorrowerMobiles],
            },
          }),
        })
        const wecomResult = await wecomResponse.json()
        console.log('WeCom webhook response:', JSON.stringify(wecomResult))
      } catch (wecomError) {
        console.error('WeCom webhook failed:', wecomError)
      }
    } else if (!wecomUrl) {
      console.log('WECOM_WEBHOOK_URL not configured, skipping WeCom notification')
    }

    return new Response(
      JSON.stringify({
        message: 'Overdue check completed',
        totalOverdueCount: uniqueRecords.length,
        newlyOverdueCount: newOverdueRecords?.length || 0,
        existingOverdueCount: existingOverdueRecords?.length || 0,
        wecomNotifiedCount: wecomItems.length,
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
