// Browser-only fixtures for documentation captures. No production code imports this file.
function mockRuntime(role) {
  const stamp = '2026-08-30T08:00:00.000Z'
  const profile = { id: 'sop-admin', display_name: role === 'user' ? '演示使用人' : '演示管理员', email: 'sop-guide@example.test', role, status: 'active', department: '培训演示', phone: null, created_at: stamp, updated_at: stamp }
  const operator = { ...profile, id: 'sop-operator', display_name: '演示使用人', email: 'operator@example.test', role: 'user' }
  const nextAdmin = { ...profile, id: 'sop-next-admin', display_name: '演示接任人', email: 'next-admin@example.test', role: 'admin' }
  const pendingUser = { ...operator, id: 'sop-pending', display_name: '待审核演示账号', email: 'pending@example.test', status: 'pending_approval' }
  const category = { id: 'sop-category', name: '行业无人机', description: '操作指引演示分类', is_active: true, created_at: stamp }
  const items = ['Matrice 4E', 'Matrice 4T', 'RC Plus 2'].map((model, index) => ({
    id: `sop-item-${index + 1}`, name: `${model} 培训样机`, model,
    barcode: `SOP-DEMO-00${index + 1}`, serial_number: `DEMO000${index + 1}`, serial_number_last4: `000${index + 1}`,
    category_id: category.id, category, category_name: category.name,
    status: index === 1 ? 'borrowed' : 'in_stock', display_status: index === 1 ? 'borrowed' : 'in_stock',
    specs: {}, location: '培训展示区', image_url: null, notes: '仅用于 SOP 截图，不是真实资产',
    current_borrower_id: index === 1 ? operator.id : null, current_borrower: index === 1 ? operator : null,
    total_count: 3, created_at: stamp, updated_at: stamp,
  }))
  const chains = [{ id: 'sop-chain', name: '标准借用审批', borrow_type: 'all', is_active: true, max_borrow_days: 30,
    steps: [{ level: 1, type: 'role', role: 'admin', label: '管理员审核' }], created_at: stamp }]
  chains.push({ ...chains[0], id: 'sop-transfer-chain', name: '转借审批', borrow_type: 'transfer' })
  const request = { id: 'sop-request', request_number: 'SOP-演示-001', requester_id: profile.id, requester: profile,
    item_id: items[1].id, item: items[1], borrow_type: 'internal', purpose: '操作培训演示，不产生真实借用',
    expected_borrow_date: '2026-08-30', expected_return_date: '2026-09-15', status: 'borrowed',
    customer_name: null, customer_contact: null, created_at: stamp, updated_at: stamp,
    request_items: [{ id: 'sop-line', request_id: 'sop-request', item_id: items[1].id, item: items[1], status: 'borrowed', quantity: 1 }],
    approval_records: [{ id: 'sop-approved', action: 'approved', acted_at: stamp, step_level: 1, approver: nextAdmin, chain: chains[0], comment: '培训示例：已核对用途及日期' }],
  }
  const pendingRequest = { ...request, id: 'sop-request-pending', request_number: 'SOP-演示-002', status: 'pending', requester_id: role === 'user' ? profile.id : operator.id, requester: role === 'user' ? profile : operator,
    request_items: [{ id: 'sop-line-pending', request_id: 'sop-request-pending', item_id: items[0].id, item: items[0], status: 'pending' }], approval_records: [] }
  const cancelledRequest = { ...pendingRequest, id: 'sop-request-cancelled', request_number: 'SOP-演示-003', status: 'cancelled', borrow_type: 'test', borrow_records: [] }
  const record = { id: 'sop-record', request_id: request.id, request_item_id: 'sop-line', request, item_id: items[1].id, item: items[1],
    borrower_id: profile.id, borrower: profile, borrow_type: 'internal', status: 'active', borrowed_at: stamp, actual_borrow_date: stamp,
    expected_return_date: '2026-09-15', due_date: '2026-09-15', returned_at: null, created_at: stamp }
  const approvals = [{ id: 'sop-approval', request_id: pendingRequest.id, request: pendingRequest, chain_id: chains[0].id, chain: chains[0],
    approver_id: profile.id, approver: profile, action: null, acted_at: null, step_level: 1, comment: null, created_at: stamp }]
  const tables = {
    profiles: [profile, operator, nextAdmin, pendingUser], items, categories: [category], approval_chains: chains,
    borrow_requests: [request, pendingRequest, cancelledRequest], borrow_records: [record], approval_records: approvals,
    user_customers: [{ id: 'sop-customer', user_id: operator.id, user: operator, customer_name: '培训演示客户', customer_contact: '演示联系人（非真实联系方式）', created_at: stamp }],
    notifications: [], overdue_notifications: [], return_photos: [], stock_movements: [], return_photo_archive_config: [{ id: 1, nas_view_base_url: 'https://sop-fixture.invalid' }],
  }
  window.__sopFixtureWrites = []
  const blockedWrite = (operation) => { window.__sopFixtureWrites.push(operation); throw new Error('SOP 截图环境禁止业务写入：' + operation) }
  const from = (table) => {
    let rows = table === 'sop_processes' ? JSON.parse(sessionStorage.getItem('sop-fixture-processes') || '[]') : [...(tables[table] || [])]
    let single = false
    const builder = {
      select() { return builder }, order() { return builder }, limit() { return builder }, range() { return builder },
      or(query) { if (query.includes('borrow_type.eq.')) rows = rows.filter((row) => row.borrow_type === 'test' || row.status === 'cancelled'); return builder },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return builder },
      neq(key, value) { rows = rows.filter((row) => row[key] !== value); return builder },
      in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return builder },
      is(key, value) { rows = rows.filter((row) => (row[key] ?? null) === value); return builder },
      not(key, op, value) { if (op === 'is') rows = rows.filter((row) => (row[key] ?? null) !== value); return builder },
      gte() { return builder }, lte() { return builder }, ilike() { return builder }, contains() { return builder },
      single() { single = true; return builder }, maybeSingle() { single = true; return builder },
      then(resolve, reject) { return Promise.resolve({ data: single ? rows[0] || null : rows, count: rows.length, error: null }).then(resolve, reject) },
      insert() { return blockedWrite(table + '.insert') }, update() { return blockedWrite(table + '.update') }, delete() { return blockedWrite(table + '.delete') }, upsert() { return blockedWrite(table + '.upsert') },
    }
    return builder
  }
  return {
    from,
    auth: {
      getSession: async () => ({ data: { session: { user: profile, access_token: 'isolated-documentation-fixture' } }, error: null }),
      getUser: async () => ({ data: { user: profile }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    rpc: async (name, args) => {
      if (name === 'replace_sop_processes') {
        sessionStorage.setItem('sop-fixture-processes', JSON.stringify(args.p_processes))
        return { data: null, error: null }
      }
      if (!/^(get_|check_|search_)/.test(name)) return blockedWrite(name)
      const data = name === 'get_items_page' ? items
        : name === 'get_borrowable_item_status_details' ? items.map((item) => ({ item_id: item.id, display_status: item.status, serial_number_last4: item.serial_number_last4 }))
          : name === 'get_transferable_item_status_details' ? [{ item_id: items[1].id, source_borrow_record_id: record.id, source_borrower_id: operator.id, source_borrower_name: operator.display_name, source_borrow_status: 'active', due_date: record.expected_return_date }]
            : name === 'check_borrow_availability' ? { available: true, conflicts: [] }
              : name === 'get_current_approval_progress' ? { current_step: { step_level: 1, step_label: '管理员审核', approver_name: profile.display_name }, previous_step: null }
                : name === 'get_dashboard_summary' ? [{ total: 3, in_stock: 2, borrowed: 1, reserved: 0, overdue: 0, maintenance: 0, retired: 0, monthly_requests: 3 }] : []
      return { data, error: null }
    },
    channel() { const channel = { on() { return channel }, subscribe() { return channel } }; return channel },
    removeChannel() {},
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    functions: { invoke: (name) => blockedWrite(name) },
  }
}

export function createMockSupabaseModule(role = 'super_admin') {
  return `export const supabase = (${mockRuntime.toString()})(${JSON.stringify(role)});`
}

export async function installSopFixtures(context, role = 'super_admin') {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      if (url.pathname.endsWith('/src/lib/supabase.ts')) return route.fulfill({ contentType: 'application/javascript', body: createMockSupabaseModule(role) })
      return route.continue()
    }
    // No screenshot ever connects to production services, analytics or external hosts.
    if (url.hostname === 'sop-fixture.invalid') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }) })
    return route.abort('blockedbyclient')
  })
}
