import { supabase } from '@/lib/supabase'
import type { BorrowRequest, BorrowRequestInput, RenewInput, BorrowRecord } from '@/types'

export const borrowService = {
  async createRequest(data: BorrowRequestInput): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data: requestId, error } = await supabase.rpc('create_borrow_request', {
      p_requester_id: user.id,
      p_item_id: data.item_id,
      p_borrow_type: data.borrow_type,
      p_purpose: data.purpose,
      p_customer_name: data.customer_name || null,
      p_customer_contact: data.customer_contact || null,
      p_expected_borrow_date: data.expected_borrow_date,
      p_expected_return_date: data.expected_return_date,
    })

    if (error) throw error
    return requestId
  },

  async cancelRequest(id: string): Promise<void> {
    const { error } = await supabase
      .from('borrow_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
    if (error) throw error
  },

  async getMyRequests(): Promise<BorrowRequest[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data, error } = await supabase
      .from('borrow_requests')
      .select('*, item:items(*, category:categories(*)), requester:profiles(*)')
      .eq('requester_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async getRequestById(id: string): Promise<BorrowRequest | null> {
    const { data, error } = await supabase
      .from('borrow_requests')
      .select('*, item:items(*, category:categories(*)), requester:profiles(*), approval_records:approval_records(*, approver:profiles(*))')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async processReturn(recordId: string, notes?: string): Promise<void> {
    const { error } = await supabase.rpc('process_return', {
      p_borrow_record_id: recordId,
      p_notes: notes || null,
    })
    if (error) throw error
  },

  async createRenewal(parentRequestId: string, data: RenewInput): Promise<string> {
    // 获取原申请信息
    const { data: originalRequest } = await supabase
      .from('borrow_requests')
      .select('*')
      .eq('id', parentRequestId)
      .single()

    if (!originalRequest) throw new Error('原申请不存在')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data: requestId, error } = await supabase.rpc('create_borrow_request', {
      p_requester_id: user.id,
      p_item_id: originalRequest.item_id,
      p_borrow_type: originalRequest.borrow_type,
      p_purpose: data.purpose || `续借申请 (原申请: ${originalRequest.request_number})`,
      p_customer_name: originalRequest.customer_name,
      p_customer_contact: originalRequest.customer_contact,
      p_expected_borrow_date: new Date().toISOString().split('T')[0],
      p_expected_return_date: data.expected_return_date,
    })

    if (error) throw error

    // 关联续借
    await supabase
      .from('borrow_requests')
      .update({ parent_request_id: parentRequestId, status: 'renewal_requested' })
      .eq('id', requestId)

    return requestId
  },

  async getBorrowRecords(filters?: { status?: string; borrower_id?: string }): Promise<BorrowRecord[]> {
    // 简化查询，避免复杂 join 超时
    let query = supabase
      .from('borrow_records')
      .select('*')
      .order('created_at', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.borrower_id) query = query.eq('borrower_id', filters.borrower_id)

    const { data, error } = await query
    if (error) {
      console.error('[getBorrowRecords] error:', error)
      throw error
    }
    return (data || []) as BorrowRecord[]
  },

  async getBorrowRecordByRequestId(requestId: string): Promise<BorrowRecord | null> {
    // 先简单查询，避免复杂 join 导致超时
    const { data, error } = await supabase
      .from('borrow_records')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle()
    if (error) {
      console.error('[getBorrowRecordByRequestId] error:', error)
      throw error
    }
    return data as BorrowRecord | null
  },

  async getMyBorrowRecords(): Promise<BorrowRecord[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')
    return this.getBorrowRecords({ borrower_id: user.id })
  },

  async getActiveBorrowForItem(itemId: string): Promise<BorrowRecord | null> {
    const { data, error } = await supabase
      .from('borrow_records')
      .select('*, item:items(*), borrower:profiles(*)')
      .eq('item_id', itemId)
      .in('status', ['active', 'overdue'])
      .single()
    if (error && error.code !== 'PGRST116') throw error
    return data
  },
}
