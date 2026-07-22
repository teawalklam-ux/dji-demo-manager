import { supabase } from '@/lib/supabase'
import type { BorrowRecord } from '@/types'

export const borrowReportService = {
  async getBorrowRecords(filters?: { status?: string; borrower_id?: string }): Promise<BorrowRecord[]> {
    const status = filters?.status && filters.status !== 'all' ? filters.status : null
    const { data, error } = await supabase.rpc('get_borrow_records_report', {
      p_status: status,
      p_borrower_id: filters?.borrower_id || null,
    })

    if (error) {
      console.error('[getBorrowRecordsReport] error:', error)
      throw error
    }

    return (data || []) as BorrowRecord[]
  },
}
