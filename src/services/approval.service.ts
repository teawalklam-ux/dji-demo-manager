import { supabase } from '@/lib/supabase'
import type { ApprovalRecord, ApprovalChain } from '@/types'

export const approvalService = {
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
      .select('*, approver:profiles(*), request:borrow_requests(*, item:items(*, category:categories(*)), requester:profiles(*)), chain:approval_chains(*)')
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
      .select('*, approver:profiles(*), request:borrow_requests(*, item:items(*, category:categories(*)), requester:profiles(*)), chain:approval_chains(*)')
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
