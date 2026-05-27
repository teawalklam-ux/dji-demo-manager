import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 短借期阈值（天）：借出时间低于此值的不提前触发逾期提醒
const SHORT_BORROW_THRESHOLD_DAYS = 3

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

    // 1. Find overdue borrow records (expected_return_date < today, still 'borrowed' or 'active')
    const today = new Date().toISOString().split('T')[0]
    const { data: overdueRecords, error: fetchError } = await supabase
      .from('borrow_records')
      .select(`
        id,
        borrower_id,
        borrow_date,
        expected_return_date,
        items (name, barcode),
        profiles:borrower_id (display_name)
      `)
      .in('status', ['borrowed', 'active'])
      .lt('expected_return_date', today)

    if (fetchError) {
      throw new Error(`Failed to fetch overdue records: ${fetchError.message}`)
    }

    if (!overdueRecords || overdueRecords.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No overdue records found', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Update item status to 'overdue'
    const recordIds = overdueRecords.map((r: any) => r.id)
    await supabase
      .from('borrow_records')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .in('id', recordIds)

    // Update items status
    const { data: borrowItems } = await supabase
      .from('borrow_records')
      .select('item_id')
      .in('id', recordIds)

    if (borrowItems && borrowItems.length > 0) {
      const itemIds = borrowItems.map((b: any) => b.item_id)
      await supabase
        .from('items')
        .update({ status: 'overdue', updated_at: new Date().toISOString() })
        .in('id', itemIds)
    }

    // 3. 区分通知策略：短借期（≤3天）只在正式逾期后通知，长借期立即通知
    const notifications: any[] = []
    const wecomItems: string[] = []

    for (const r of overdueRecords) {
      const borrowDate = new Date(r.borrow_date)
      const returnDate = new Date(r.expected_return_date)
      const borrowDays = Math.ceil((returnDate.getTime() - borrowDate.getTime()) / (1000 * 60 * 60 * 24))

      // 所有逾期记录都发送通知（正式逾期后才到这里）
      // 但短借期的不发送企业微信提醒，只发站内通知
      notifications.push({
        borrow_record_id: r.id,
        borrower_id: r.borrower_id,
        notification_type: 'push',
        message: `您借用的样机「${r.items?.name || '未知'}」已逾期，预期归还日期为 ${r.expected_return_date}，请尽快归还。`,
        is_read: false,
      })

      // 长借期（>3天）才发送企业微信提醒
      if (borrowDays > SHORT_BORROW_THRESHOLD_DAYS) {
        wecomItems.push(
          `- ${r.profiles?.display_name || '未知用户'}：「${r.items?.name || '未知'}」逾期，应还 ${r.expected_return_date}`
        )
      }
    }

    const { error: notifError } = await supabase
      .from('overdue_notifications')
      .insert(notifications)

    if (notifError) {
      console.error('Failed to insert notifications:', notifError)
    }

    // 4. Send WeCom webhook notification (only for long-borrow overdue)
    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    if (wecomUrl && wecomItems.length > 0) {
      const overdueList = wecomItems.join('\n')

      try {
        await fetch(wecomUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'text',
            text: {
              content: `【样机逾期提醒】\n以下样机已逾期，请跟进处理：\n${overdueList}`,
              mentioned_mobile_list: [],
            },
          }),
        })
      } catch (wecomError) {
        console.error('WeCom webhook failed:', wecomError)
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Overdue check completed',
        overdueCount: overdueRecords.length,
        wecomNotifiedCount: wecomItems.length,
        shortBorrowSkipped: overdueRecords.length - wecomItems.length,
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
