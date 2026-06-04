import { supabase } from '@/lib/supabase'
import type { BorrowRequest, BorrowRequestInput, RenewInput, BorrowRecord } from '@/types'
import type { PhotoData } from '@/components/borrow/return-photo-capture'

export interface ProcessReturnData {
  notes?: string
  photo: PhotoData
}

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

    // 异步触发企业微信审批通知（不阻塞前端）
    this.triggerApprovalNotification(requestId).catch(console.error)

    return requestId
  },

  /** 异步调用 Edge Function 发送企业微信审批通知 */
  async triggerApprovalNotification(requestId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      await fetch(`${supabaseUrl}/functions/v1/notify-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ request_id: requestId }),
      })
    } catch (err) {
      console.error('Failed to trigger approval notification:', err)
    }
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
      .select('*')
      .eq('id', id)
      .single()
    if (error) {
      console.error('[getRequestById] error:', error)
      throw error
    }
    return data as BorrowRequest | null
  },

  async processReturn(recordId: string, data: ProcessReturnData): Promise<void> {
    // 1. 上传照片到 Storage
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const filePath = `${user.id}/${recordId}/${Date.now()}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('return-photos')
      .upload(filePath, data.photo.blob, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('[processReturn] 照片上传失败:', uploadError)
      throw new Error('照片上传失败: ' + uploadError.message)
    }

    // 2. 调用 process_return RPC（含照片数据）
    const { error } = await supabase.rpc('process_return', {
      p_borrow_record_id: recordId,
      p_notes: data.notes || null,
      p_photo_storage_path: filePath,
      p_photo_captured_at: data.photo.capturedAt.toISOString(),
      p_photo_latitude: data.photo.latitude,
      p_photo_longitude: data.photo.longitude,
      p_photo_address: data.photo.address,
    })
    if (error) {
      // 如果 RPC 失败，尝试清理已上传的照片
      try {
        await supabase.storage.from('return-photos').remove([filePath])
      } catch (cleanupErr) {
        console.error('[processReturn] 清理上传照片失败:', cleanupErr)
      }
      throw error
    }
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
    // 关联 borrower 和 item 以支持导出借用人/样机名称/样机型号
    let query = supabase
      .from('borrow_records')
      .select('*, borrower:profiles(*), item:items(*)')
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
