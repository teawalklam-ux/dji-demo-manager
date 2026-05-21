import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // 1. Find overdue borrow records (expected_return_date < today, still 'borrowed')
    const today = new Date().toISOString().split('T')[0]
    const { data: overdueRecords, error: fetchError } = await supabase
      .from('borrow_records')
      .select(`
        id,
        borrower_id,
        expected_return_date,
        items (name, barcode),
        profiles:borrower_id (display_name)
      `)
      .eq('status', 'borrowed')
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
    const overdueItemIds = overdueRecords.map((r: any) => r.items?.id).filter(Boolean)

    // Update borrow records status
    const recordIds = overdueRecords.map((r: any) => r.id)
    await supabase
      .from('borrow_records')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .in('id', recordIds)

    // Update items status
    if (overdueItemIds.length > 0) {
      // Get item IDs from borrow records
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
    }

    // 3. Create in-app notifications
    const notifications = overdueRecords.map((r: any) => ({
      borrow_record_id: r.id,
      borrower_id: r.borrower_id,
      notification_type: 'push',
      message: `您借用的样机「${r.items?.name || '未知'}」已逾期，预期归还日期为 ${r.expected_return_date}，请尽快归还。`,
      is_read: false,
    }))

    const { error: notifError } = await supabase
      .from('overdue_notifications')
      .insert(notifications)

    if (notifError) {
      console.error('Failed to insert notifications:', notifError)
    }

    // 4. Send WeCom webhook notification (if configured)
    const wecomUrl = Deno.env.get('WECOM_WEBHOOK_URL')
    if (wecomUrl) {
      const overdueList = overdueRecords.map((r: any) =>
        `- ${r.profiles?.display_name || '未知用户'}：「${r.items?.name || '未知'}」逾期，应还 ${r.expected_return_date}`
      ).join('\n')

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
