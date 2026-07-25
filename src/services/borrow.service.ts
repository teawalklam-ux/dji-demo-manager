import { supabase } from '@/lib/supabase'
import type { BorrowRequest, BorrowRequestInput, RenewInput, BorrowRecord } from '@/types'
import type { PhotoData } from '@/components/borrow/return-photo-capture'
import { TEST_BORROW_TYPE } from '@/lib/borrow-request-cleanup'

export interface ProcessReturnData {
  notes?: string
  photo: PhotoData
}

export type DeletableBorrowRequest = Omit<BorrowRequest, 'approval_records'> & {
  approval_records?: Array<{ id: string }>
  borrow_records?: Array<{ id: string; item_id: string; status: BorrowRecord['status'] }>
}

export interface DeleteBorrowRequestResult {
  request_id: string
  request_number: string
  deletion_reason: 'test' | 'cancelled' | 'test_and_cancelled'
  deleted_approval_count: number
  deleted_borrow_record_count: number
  deleted_notification_count: number
  deleted_movement_count: number
  queued_photo_count: number
  restored_item_count: number
}

export const borrowService = {
  async createRequest(data: BorrowRequestInput): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data: requestId, error } = await supabase.rpc('create_borrow_request', {
      p_requester_id: user.id,
      p_item_ids: data.item_ids,
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data, error } = await supabase
      .from('borrow_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('requester_id', user.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('申请不存在、已处理或无权取消')
  },

  async getMyRequests(): Promise<BorrowRequest[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data, error } = await supabase
      .from('borrow_requests')
      .select('*, requester:profiles(*), request_items:borrow_request_items(*, item:items(*, category:categories(*)))')
      .eq('requester_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  /** 管理员记录清理页：只返回“测试”类型或用户已取消的申请。 */
  async getDeletableRequests(): Promise<DeletableBorrowRequest[]> {
    const { data, error } = await supabase
      .from('borrow_requests')
      .select(`
        *,
        requester:profiles(id, display_name, department),
        request_items:borrow_request_items(id, request_id, item_id, status, item:items(id, name, model)),
        approval_records(id),
        borrow_records(id, item_id, status)
      `)
      .or(`borrow_type.eq.${TEST_BORROW_TYPE},status.eq.cancelled`)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []) as unknown as DeletableBorrowRequest[]
  },

  /** 由数据库再次校验管理员身份和删除范围，并原子清理关联记录。 */
  async deleteEligibleRequest(requestId: string): Promise<DeleteBorrowRequestResult> {
    const { data, error } = await supabase.rpc('delete_eligible_borrow_request', {
      p_request_id: requestId,
    })
    if (error) throw error
    return data as DeleteBorrowRequestResult
  },

  async getRecentRequestsForDashboard(userId: string, limit = 5): Promise<BorrowRequest[]> {
    const { data, error } = await supabase
      .from('borrow_requests')
      .select(`
        id,
        request_number,
        status,
        created_at,
        item:items(id, name, model),
        request_items:borrow_request_items(item:items(id, name, model))
      `)
      .eq('requester_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data || []) as unknown as BorrowRequest[]
  },

  async getRequestById(id: string): Promise<BorrowRequest | null> {
    const { data, error } = await supabase
      .from('borrow_requests')
      .select('*, requester:profiles(*), request_items:borrow_request_items(*, item:items(*, category:categories(*))), approval_records(*, approver:profiles(*), chain:approval_chains(*))')
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

    // 3. 归还成功后触发企业微信通知。通知失败不回滚已完成的归还操作。
    await this.triggerReturnNotification(recordId)
  },

  /** 调用 Edge Function 发送企业微信归还通知。 */
  async triggerReturnNotification(recordId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        console.error('[triggerReturnNotification] 未找到登录会话')
        return
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const response = await fetch(`${supabaseUrl}/functions/v1/notify-return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ borrow_record_id: recordId }),
      })

      if (!response.ok) {
        console.error('[triggerReturnNotification] 企业微信归还通知失败:', await response.text())
      }
    } catch (error) {
      console.error('[triggerReturnNotification] 企业微信归还通知失败:', error)
    }
  },

  async createRenewal(parentRequestId: string, data: RenewInput): Promise<string> {
    // 获取原申请信息
    const { data: originalRequest } = await supabase
      .from('borrow_requests')
      .select('*, request_items:borrow_request_items(item_id)')
      .eq('id', parentRequestId)
      .single()

    if (!originalRequest) throw new Error('原申请不存在')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data: requestId, error } = await supabase.rpc('create_borrow_request', {
      p_requester_id: user.id,
      p_item_ids: (originalRequest.request_items || []).map((line: { item_id: string }) => line.item_id),
      p_borrow_type: originalRequest.borrow_type,
      p_purpose: data.purpose || `续借申请 (原申请: ${originalRequest.request_number})`,
      p_customer_name: originalRequest.customer_name,
      p_customer_contact: originalRequest.customer_contact,
      p_expected_borrow_date: new Date().toISOString().split('T')[0],
      p_expected_return_date: data.expected_return_date,
      p_parent_request_id: parentRequestId,
    })

    if (error) throw error

    return requestId
  },

  async checkAvailability(itemIds: string[], expectedBorrowDate: string, expectedReturnDate: string) {
    const { data, error } = await supabase.rpc('check_borrow_availability', {
      p_item_ids: itemIds,
      p_expected_borrow_date: expectedBorrowDate,
      p_expected_return_date: expectedReturnDate,
    })
    if (error) throw error
    return data as Array<{ item_id: string; item_name: string; occupied_start_date: string; occupied_end_date: string; occupied_status: string }>
  },

  async getBorrowRecords(filters?: { status?: string; borrower_id?: string }): Promise<BorrowRecord[]> {
    // 关联 borrower 和 item 以支持导出借用人/样机名称/样机型号
    let query = supabase
      .from('borrow_records')
      .select('*, borrower:profiles(*), item:items(*), request_item:borrow_request_items(*)')
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
