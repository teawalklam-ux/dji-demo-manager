import { supabase } from '@/lib/supabase'
import type { ApprovalRecord, ApprovalChain } from '@/types'

export const approvalService = {
  async getPendingApprovals(): Promise<ApprovalRecord[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data, error } = await supabase
      .from('approval_records')
      .select('*, approver:profiles(*), request:borrow_requests(*, item:items(*, category:categories(*)), requester:profiles(*)), chain:approval_chains(*)')
      .eq('approver_id', user.id)
      .is('acted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async getProcessedApprovals(): Promise<ApprovalRecord[]> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('未登录')

    const { data, error } = await supabase
      .from('approval_records')
      .select('*, approver:profiles(*), request:borrow_requests(*, item:items(*, category:categories(*)), requester:profiles(*)), chain:approval_chains(*)')
      .eq('approver_id', user.id)
      .not('acted_at', 'is', null)
      .order('acted_at', { ascending: false })
    if (error) throw error
    return data || []
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

  async createChain(data: { name: string; borrow_type: string; steps: ApprovalChain['steps'] }): Promise<ApprovalChain> {
    const { data: chain, error } = await supabase
      .from('approval_chains')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    return chain
  },

  async updateChain(id: string, data: Partial<{ name: string; borrow_type: string; steps: ApprovalChain['steps']; is_active: boolean }>): Promise<ApprovalChain> {
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
