import { supabase } from '@/lib/supabase'
import type { ApprovalRecord, ApprovalChain, ApprovalProgress } from '@/types'

export const approvalService = {
  async getCurrentApprovalProgress(requestId: string): Promise<ApprovalProgress> {
    const { data, error } = await supabase.rpc('get_current_approval_progress', {
      p_request_id: requestId,
    })
    if (error) throw error
    return data as ApprovalProgress
  },

  async getPendingApprovals(): Promise<ApprovalRecord[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    // 先获取当前用户角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin'

    // super_admin/admin 能看到所有未审批记录，其他角色只能看到自己的
    let query = supabase
      .from('approval_records')
      .select('*, approver:profiles(*), request:borrow_requests(*, requester:profiles(*), request_items:borrow_request_items(*, item:items(*, category:categories(*)))), chain:approval_chains(*)')
      .is('acted_at', null)
      .order('created_at', { ascending: false })

    if (!isAdmin) {
      query = query.eq('approver_id', user.id)
    }

    const { data, error } = await query
    if (error) throw error

    // 按 request_id 去重：多步审批链会为同一申请创建多条记录，
    // 审批列表中每个申请只显示当前待审批的第一步（step_level 最小的未处理记录）
    const seen = new Map<string, ApprovalRecord>()
    for (const record of (data || [])) {
      const existing = seen.get(record.request_id)
      if (!existing || record.step_level < existing.step_level) {
        seen.set(record.request_id, record)
      }
    }
    return Array.from(seen.values())
  },

  async getPendingApprovalsForDashboard(userId: string, isAdmin: boolean): Promise<ApprovalRecord[]> {
    let query = supabase
      .from('approval_records')
      .select(`
        id,
        request_id,
        chain_id,
        approver_id,
        step_level,
        action,
        comment,
        acted_at,
        created_at,
        request:borrow_requests(
          id,
          request_number,
          requester_id,
          item_id,
          borrow_type,
          expected_borrow_date,
          status,
          requester:profiles(id, display_name),
          item:items(id, name, model),
          request_items:borrow_request_items(id, item_id, item:items(id, name, model))
        )
      `)
      .is('acted_at', null)
      .order('created_at', { ascending: false })

    if (!isAdmin) {
      query = query.eq('approver_id', userId)
    }

    const { data, error } = await query
    if (error) throw error

    const seen = new Map<string, ApprovalRecord>()
    for (const record of (data || []) as unknown as ApprovalRecord[]) {
      const existing = seen.get(record.request_id)
      if (!existing || record.step_level < existing.step_level) {
        seen.set(record.request_id, record)
      }
    }
    return Array.from(seen.values())
  },

  async getProcessedApprovals(): Promise<ApprovalRecord[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    // 先获取当前用户角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin'

    // super_admin/admin 能看到所有已审批记录，其他角色只能看到自己的
    let query = supabase
      .from('approval_records')
      .select('*, approver:profiles(*), request:borrow_requests(*, requester:profiles(*), request_items:borrow_request_items(*, item:items(*, category:categories(*)))), chain:approval_chains(*)')
      .not('acted_at', 'is', null)
      .order('acted_at', { ascending: false })

    if (!isAdmin) {
      query = query.eq('approver_id', user.id)
    }

    const { data, error } = await query
    if (error) throw error

    // 按 request_id 去重：多步审批链会为同一申请创建多条记录，
    // 已审批列表中每个申请只显示最后一步（step_level 最大的），反映最终审批结果
    const seen = new Map<string, ApprovalRecord>()
    for (const record of (data || [])) {
      const existing = seen.get(record.request_id)
      if (!existing || record.step_level > existing.step_level) {
        seen.set(record.request_id, record)
      }
    }
    return Array.from(seen.values())
  },

  async processApproval(requestId: string, action: 'approved' | 'rejected', comment?: string): Promise<void> {
    const { error } = await supabase.rpc('process_approval', {
      p_request_id: requestId,
      p_action: action,
      p_comment: comment || null,
    })
    if (error) throw error

    // 审批后触发企业微信通知（通知下一步审批人 / 通知申请人审批结果）
    this.triggerApprovalNotification(requestId).catch(console.error)
  },

  /** 超级管理员撤销已通过的审批（仅 super_admin 可用） */
  async revokeApproval(requestId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('revoke_approval', {
      p_request_id: requestId,
      p_reason: reason,
    })
    if (error) throw error
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

  async getChains(): Promise<ApprovalChain[]> {
    const { data, error } = await supabase
      .from('approval_chains')
      .select('*')
      .order('created_at')
    if (error) throw error
    return data || []
  },

  async createChain(data: { name: string; borrow_type: string; steps: ApprovalChain['steps']; max_borrow_days?: number | null }): Promise<ApprovalChain> {
    const { data: chain, error } = await supabase
      .from('approval_chains')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    return chain
  },

  async updateChain(id: string, data: Partial<{ name: string; borrow_type: string; steps: ApprovalChain['steps']; max_borrow_days: number | null; is_active: boolean }>): Promise<ApprovalChain> {
    const { data: chain, error } = await supabase
      .from('approval_chains')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return chain
  },

  async deleteChain(id: string): Promise<void> {
    const { error } = await supabase.from('approval_chains').delete().eq('id', id)
    if (error) throw error
  },
}
