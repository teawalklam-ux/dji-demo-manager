import { supabase } from '@/lib/supabase'
import type { Item, ItemCreateInput, ItemFilters, PaginatedResponse } from '@/types'

type BorrowableItemStatusDetail = {
  item_id: string
  display_status: 'in_stock' | 'reserved' | 'borrowed'
  reserved_start_date: string | null
  reserved_end_date: string | null
  due_date: string | null
}

export const itemsService = {
  async getAll(filters?: ItemFilters): Promise<PaginatedResponse<Item>> {
    let query = supabase
      .from('items')
      .select('*, category:categories(*), current_borrower:profiles(*)', { count: 'exact' })

    if (filters?.search) {
      const s = filters.search.replace(/%/g, '\\%').replace(/_/g, '\\_')
      query = query.or(`name.ilike.%${s}%,model.ilike.%${s}%,barcode.ilike.%${s}%,serial_number.ilike.%${s}%`)
    }
    if (filters?.category_id) {
      query = query.eq('category_id', filters.category_id)
    }
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }

    query = query.order('created_at', { ascending: false })

    const { data, count, error } = await query
    if (error) throw error
    return { data: data || [], count: count || 0 }
  },

  async getById(id: string): Promise<Item | null> {
    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*), current_borrower:profiles(*)')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async getByBarcode(barcode: string): Promise<Item | null> {
    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*), current_borrower:profiles(*)')
      .eq('barcode', barcode)
      .single()
    if (error) throw error
    return data
  },

  async create(data: ItemCreateInput): Promise<Item> {
    const { data: item, error } = await supabase
      .from('items')
      .insert(data)
      .select('*, category:categories(*)')
      .single()
    if (error) throw error

    // 记录库存变动
    await supabase.from('stock_movements').insert({
      item_id: item.id,
      movement_type: 'new_entry',
      operator_id: (await supabase.auth.getUser()).data.user?.id,
      notes: '新样机入库',
    })

    return item
  },

  async update(id: string, data: Partial<ItemCreateInput>): Promise<Item> {
    const { data: item, error } = await supabase
      .from('items')
      .update(data)
      .eq('id', id)
      .select('*, category:categories(*)')
      .single()
    if (error) throw error
    return item
  },

  async delete(id: string): Promise<void> {
    // 先删除关联记录（外键约束顺序：approval_records → borrow_records → stock_movements → borrow_requests → items）
    // 1. 删除审批记录（borrow_requests 有 ON DELETE CASCADE，但 borrow_records 没有）
    const { error: arErr } = await supabase
      .from('approval_records')
      .delete()
      .in('request_id', (await supabase.from('borrow_requests').select('id').eq('item_id', id)).data?.map(r => r.id) || [])
    if (arErr) console.warn('删除审批记录失败:', arErr.message)

    // 2. 删除借用记录
    const { error: brErr } = await supabase.from('borrow_records').delete().eq('item_id', id)
    if (brErr) console.warn('删除借用记录失败:', brErr.message)

    // 3. 删除库存变动记录
    const { error: smErr } = await supabase.from('stock_movements').delete().eq('item_id', id)
    if (smErr) console.warn('删除库存变动记录失败:', smErr.message)

    // 4. 删除借用申请
    const { error: reqErr } = await supabase.from('borrow_requests').delete().eq('item_id', id)
    if (reqErr) console.warn('删除借用申请失败:', reqErr.message)

    // 5. 删除样机
    const { error } = await supabase.from('items').delete().eq('id', id)
    if (error) throw error
  },

  async getInStockItems(): Promise<Item[]> {
    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*)')
      .eq('status', 'in_stock')
      .order('name')
    if (error) throw error
    return data || []
  },

  /** 可预约样机：借出/逾期样机也可选择未来无冲突日期，维修与退役样机不可申请。 */
  async getBorrowableItems(): Promise<Item[]> {
    const [itemsResult, statusResult] = await Promise.all([
      supabase
        .from('items')
        .select('*, category:categories(*)')
        .in('status', ['in_stock', 'borrowed', 'overdue'])
        .order('name'),
      supabase.rpc('get_borrowable_item_status_details'),
    ])
    if (itemsResult.error) throw itemsResult.error
    if (statusResult.error) throw statusResult.error

    const statusByItemId = new Map<string, BorrowableItemStatusDetail>(
      (statusResult.data || []).map((detail: BorrowableItemStatusDetail) => [detail.item_id, detail])
    )

    return (itemsResult.data || []).map((item) => {
      const detail = statusByItemId.get(item.id)
      return {
        ...item,
        availability_status: detail?.display_status || (item.status === 'in_stock' ? 'in_stock' : 'borrowed'),
        reservation_start_date: detail?.reserved_start_date || null,
        reservation_end_date: detail?.reserved_end_date || null,
        current_due_date: detail?.due_date || null,
      }
    })
  },

  /** 获取借出日期尚未到、且已审批预约的在库样机。 */
  async getReservedItemIds(): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_reserved_item_ids')
    if (error) throw error
    return new Set((data || []).map((row: { item_id: string }) => row.item_id))
  },

  async getStats() {
    const { count: total } = await supabase.from('items').select('*', { count: 'exact', head: true })
    const { count: inStock } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'in_stock')
    const { count: borrowed } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'borrowed')
    const { count: overdue } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('status', 'overdue')
    return { total: total || 0, inStock: inStock || 0, borrowed: borrowed || 0, overdue: overdue || 0 }
  },
}
