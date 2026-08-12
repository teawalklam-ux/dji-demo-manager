import { supabase } from '@/lib/supabase'
import type { Item, ItemCreateInput, ItemDisplayStatus, ItemFilters, PaginatedResponse } from '@/types'

type BorrowableItemStatusDetail = {
  item_id: string
  display_status: 'in_stock' | 'reserved' | 'borrowed'
  reserved_start_date: string | null
  reserved_end_date: string | null
  due_date: string | null
  serial_number_last4: string | null
}

type DashboardSummaryRow = {
  total: number
  in_stock: number
  reserved: number
  borrowed: number
  overdue: number
  maintenance: number
  retired: number
  monthly_requests: number
}

type ItemPageRow = {
  id: string
  barcode: string
  name: string
  model: string
  category_id: string
  status: Item['status']
  display_status: ItemDisplayStatus
  location: string | null
  created_at: string
  updated_at: string
  category_name: string | null
  total_count: number
}

type ItemPageFilters = ItemFilters & {
  display_status?: ItemDisplayStatus
  page?: number
  page_size?: number
}

export const itemsService = {
  async getPage(filters?: ItemPageFilters): Promise<PaginatedResponse<Item>> {
    const page = Math.max(filters?.page || 1, 1)
    const pageSize = Math.min(Math.max(filters?.page_size || 50, 1), 100)
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return demoApi.getItems({
          search: filters?.search,
          category_id: filters?.category_id,
          status: filters?.display_status || filters?.status,
          page,
          page_size: pageSize,
        })
      }
    }

    const { data, error } = await supabase.rpc('get_items_page', {
      p_search: filters?.search?.trim() || null,
      p_category_id: filters?.category_id || null,
      p_status: filters?.display_status || filters?.status || null,
      p_offset: (page - 1) * pageSize,
      p_limit: pageSize,
    })
    if (error) throw error

    const rows = (data || []) as ItemPageRow[]
    const items = rows.map((row): Item => ({
      id: row.id,
      barcode: row.barcode,
      name: row.name,
      model: row.model,
      serial_number: null,
      category_id: row.category_id,
      status: row.status,
      display_status: row.display_status,
      specs: {},
      purchase_date: null,
      purchase_price: null,
      notes: null,
      image_url: null,
      location: row.location,
      current_borrower_id: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      category: row.category_name
        ? {
            id: row.category_id,
            name: row.category_name,
            code: '',
            description: null,
            icon_name: null,
            sort_order: 0,
            is_active: true,
            created_at: '',
          }
        : undefined,
    }))

    return { data: items, count: rows[0]?.total_count || 0 }
  },

  async getAll(filters?: ItemFilters): Promise<PaginatedResponse<Item>> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return demoApi.getItems({
          search: filters?.search,
          category_id: filters?.category_id,
          status: filters?.status,
          page: 1,
          page_size: 100,
        })
      }
    }

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
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return demoApi.getItem(id)
      }
    }

    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*), current_borrower:profiles(*)')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  },

  async getByBarcode(barcode: string): Promise<Item | null> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        const result = await demoApi.getItems({ search: barcode, page_size: 100 })
        return result.data.find((item) => item.barcode === barcode) || null
      }
    }

    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*), current_borrower:profiles(*)')
      .eq('barcode', barcode)
      .single()
    if (error) throw error
    return data
  },

  async create(data: ItemCreateInput): Promise<Item> {
    if (import.meta.env.DEV) {
      const { isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        throw new Error('本地演示账号不允许新增样机')
      }
    }

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
    if (import.meta.env.DEV) {
      const { isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        throw new Error('本地演示账号不允许修改样机')
      }
    }

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
    if (import.meta.env.DEV) {
      const { isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        throw new Error('本地演示账号不允许删除样机')
      }
    }

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
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        const result = await demoApi.getItems({ status: 'in_stock', page_size: 100 })
        return result.data
      }
    }

    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(*)')
      .eq('status', 'in_stock')
      .order('name')
    if (error) throw error
    return data || []
  },

  /** 可预约样机：在库或正常借出样机可选择无冲突日期；逾期、维修与退役样机不可申请。 */
  async getBorrowableItems(): Promise<Item[]> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        const result = await demoApi.getItems({ borrowable: true, page_size: 100 })
        return result.data
      }
    }

    const [itemsResult, statusResult] = await Promise.all([
      supabase
        .from('items')
        .select(`
          id,
          barcode,
          name,
          model,
          category_id,
          status,
          specs,
          purchase_date,
          purchase_price,
          notes,
          image_url,
          location,
          current_borrower_id,
          created_at,
          updated_at,
          category:categories(*)
        `)
        .in('status', ['in_stock', 'borrowed'])
        .order('name'),
      supabase.rpc('get_borrowable_item_status_details'),
    ])
    if (itemsResult.error) throw itemsResult.error
    if (statusResult.error) throw statusResult.error

    const statusByItemId = new Map<string, BorrowableItemStatusDetail>(
      (statusResult.data || []).map((detail: BorrowableItemStatusDetail) => [detail.item_id, detail])
    )

    const borrowableItems = (itemsResult.data || []) as unknown as Array<Omit<Item, 'serial_number'>>

    return borrowableItems.map((item) => {
      const detail = statusByItemId.get(item.id)
      return {
        ...item,
        serial_number: null,
        serial_number_last4: detail?.serial_number_last4 || null,
        availability_status: detail?.display_status || (item.status === 'in_stock' ? 'in_stock' : 'borrowed'),
        reservation_start_date: detail?.reserved_start_date || null,
        reservation_end_date: detail?.reserved_end_date || null,
        current_due_date: detail?.due_date || null,
      }
    })
  },

  /** 获取借出日期尚未到、且已审批预约的在库样机。 */
  async getReservedItemIds(): Promise<Set<string>> {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return new Set(await demoApi.getReservedItemIds())
      }
    }

    const { data, error } = await supabase.rpc('get_reserved_item_ids')
    if (error) throw error
    return new Set((data || []).map((row: { item_id: string }) => row.item_id))
  },

  async getStats() {
    if (import.meta.env.DEV) {
      const { demoApi, isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) {
        return demoApi.getDashboardSummary()
      }
    }

    const { data, error } = await supabase.rpc('get_dashboard_summary')
    if (error) throw error

    const summary = ((data || []) as DashboardSummaryRow[])[0]
    return {
      total: summary?.total || 0,
      inStock: summary?.in_stock || 0,
      reserved: summary?.reserved || 0,
      borrowed: summary?.borrowed || 0,
      overdue: summary?.overdue || 0,
      maintenance: summary?.maintenance || 0,
      retired: summary?.retired || 0,
      monthlyRequests: summary?.monthly_requests || 0,
    }
  },
}
