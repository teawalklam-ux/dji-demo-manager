import { createServer } from 'node:http'

const HOST = '127.0.0.1'
const PORT = 5176
const DEMO_EMAIL = 'demo@local.test'
const DEMO_PASSWORD = 'demo123456'
const DEMO_USER_ID = 'demo-user-local'
const NOW = '2026-07-28T09:00:00.000Z'

const categories = [
  {
    id: 'cat-aircraft',
    name: '航拍无人机',
    code: 'AIR',
    description: '本地演示分类',
    icon_name: null,
    sort_order: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cat-handheld',
    name: '手持影像',
    code: 'HAND',
    description: '本地演示分类',
    icon_name: null,
    sort_order: 2,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cat-stabilizer',
    name: '稳定器与音频',
    code: 'STAB',
    description: '本地演示分类',
    icon_name: null,
    sort_order: 3,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cat-enterprise',
    name: '行业应用',
    code: 'ENT',
    description: '本地演示分类',
    icon_name: null,
    sort_order: 4,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
]

const itemSeeds = [
  ['item-001', 'DJI000001', 'DJI Mavic 3 Pro', 'Mavic 3 Pro', 'cat-aircraft', 'in_stock', 'in_stock', '展示柜 A-01'],
  ['item-002', 'DJI000002', 'DJI Mini 4 Pro', 'Mini 4 Pro 畅飞套装', 'cat-aircraft', 'in_stock', 'reserved', '展示柜 A-02'],
  ['item-003', 'DJI000003', 'DJI Air 3S', 'Air 3S', 'cat-aircraft', 'borrowed', 'borrowed', '客户体验中心'],
  ['item-004', 'DJI000004', 'DJI Avata 2', 'Avata 2 进阶套装', 'cat-aircraft', 'in_stock', 'in_stock', '展示柜 A-04'],
  ['item-005', 'DJI000005', 'Osmo Pocket 3', 'Pocket 3 全能套装', 'cat-handheld', 'borrowed', 'borrowed', '市场活动组'],
  ['item-006', 'DJI000006', 'Osmo Action 5 Pro', 'Action 5 Pro', 'cat-handheld', 'overdue', 'overdue', '外借逾期'],
  ['item-007', 'DJI000007', 'DJI RS 4 Pro', 'RS 4 Pro 套装', 'cat-stabilizer', 'maintenance', 'maintenance', '维修台 M-01'],
  ['item-008', 'DJI000008', 'DJI Mic 2', '一拖二套装', 'cat-stabilizer', 'in_stock', 'in_stock', '配件柜 B-03'],
  ['item-009', 'DJI000009', 'DJI Matrice 350 RTK', 'M350 RTK', 'cat-enterprise', 'in_stock', 'in_stock', '行业仓 E-01'],
  ['item-010', 'DJI000010', 'Zenmuse H30T', 'H30T', 'cat-enterprise', 'retired', 'retired', '退役区 R-02'],
  ['item-011', 'DJI000011', 'DJI Neo', 'Neo 畅飞套装', 'cat-aircraft', 'in_stock', 'in_stock', '展示柜 A-05'],
  ['item-012', 'DJI000012', 'DJI Inspire 3', 'Inspire 3', 'cat-aircraft', 'borrowed', 'borrowed', '影视项目组'],
]

const items = itemSeeds.map((seed, index) => {
  const [id, barcode, name, model, categoryId, status, displayStatus, location] = seed
  const category = categories.find((entry) => entry.id === categoryId)
  return {
    id,
    barcode,
    name,
    model,
    serial_number: `DEMO-SN-${String(index + 1).padStart(4, '0')}`,
    category_id: categoryId,
    status,
    display_status: displayStatus,
    availability_status: displayStatus === 'reserved' ? 'reserved' : status === 'in_stock' ? 'in_stock' : 'borrowed',
    reservation_start_date: displayStatus === 'reserved' ? '2026-08-02' : null,
    reservation_end_date: displayStatus === 'reserved' ? '2026-08-05' : null,
    current_due_date: status === 'borrowed' || status === 'overdue' ? '2026-07-26' : null,
    serial_number_last4: String(index + 1).padStart(4, '0'),
    specs: {
      数据来源: '本地演示',
      演示编号: String(index + 1).padStart(2, '0'),
    },
    purchase_date: `2025-${String((index % 9) + 1).padStart(2, '0')}-15`,
    purchase_price: 5000 + index * 2800,
    notes: '仅用于本地界面测试，不代表真实库存。',
    image_url: null,
    location,
    current_borrower_id: status === 'borrowed' || status === 'overdue' ? DEMO_USER_ID : null,
    created_at: `2026-0${(index % 6) + 1}-10T08:00:00.000Z`,
    updated_at: NOW,
    category,
    current_borrower: status === 'borrowed' || status === 'overdue'
      ? {
          id: DEMO_USER_ID,
          display_name: '本地演示员',
          email: DEMO_EMAIL,
          department: '产品体验部',
        }
      : undefined,
  }
})

const demoProfile = {
  id: DEMO_USER_ID,
  display_name: '本地演示员',
  email: DEMO_EMAIL,
  phone: null,
  department: '本地演示环境',
  role: 'user',
  avatar_url: null,
  is_active: true,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: NOW,
}

const demoUser = {
  id: DEMO_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: DEMO_EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  phone: '',
  confirmed_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: NOW,
  app_metadata: { provider: 'local-demo', providers: ['local-demo'] },
  user_metadata: { display_name: demoProfile.display_name },
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: NOW,
  is_anonymous: false,
}

const recentRequests = [
  createRequest('request-001', 'DEMO-202607-001', 'item-003', 'marketing', 'borrowed', '2026-07-24T10:00:00.000Z'),
  createRequest('request-002', 'DEMO-202607-002', 'item-002', 'customer', 'approved', '2026-07-22T09:20:00.000Z'),
  createRequest('request-003', 'DEMO-202607-003', 'item-006', 'customer', 'overdue', '2026-07-18T14:30:00.000Z'),
]

const stockMovements = [
  createMovement('move-001', 'item-003', 'borrow_out', '样机借出', '2026-07-28T08:20:00.000Z'),
  createMovement('move-002', 'item-002', 'new_entry', '预约状态更新', '2026-07-27T16:10:00.000Z'),
  createMovement('move-003', 'item-008', 'return_in', '样机归还并完成检查', '2026-07-27T11:40:00.000Z'),
  createMovement('move-004', 'item-007', 'maintenance', '送往本地演示维修台', '2026-07-26T15:15:00.000Z'),
  createMovement('move-005', 'item-005', 'borrow_out', '市场活动借出', '2026-07-25T09:00:00.000Z'),
  createMovement('move-006', 'item-011', 'new_entry', '新样机入库', '2026-07-24T13:05:00.000Z'),
]

let notifications = [
  {
    id: 'notification-001',
    borrow_record_id: 'record-006',
    borrower_id: DEMO_USER_ID,
    notification_type: 'push',
    notification_category: 'overdue',
    recipient_id: DEMO_USER_ID,
    borrow_request_id: 'request-003',
    message: 'Osmo Action 5 Pro 已逾期，请及时跟进。',
    sent_at: '2026-07-28T08:30:00.000Z',
    is_read: false,
  },
  {
    id: 'notification-002',
    borrow_record_id: null,
    borrower_id: DEMO_USER_ID,
    notification_type: 'push',
    notification_category: 'approval',
    recipient_id: DEMO_USER_ID,
    borrow_request_id: 'request-002',
    message: 'DJI Mini 4 Pro 的预约申请已通过。',
    sent_at: '2026-07-27T17:00:00.000Z',
    is_read: true,
  },
]

function createRequest(id, requestNumber, itemId, borrowType, status, createdAt) {
  const item = items.find((entry) => entry.id === itemId)
  return {
    id,
    request_number: requestNumber,
    requester_id: DEMO_USER_ID,
    item_id: itemId,
    borrow_type: borrowType,
    purpose: '本地演示流程',
    customer_name: '本地演示客户',
    customer_contact: null,
    expected_borrow_date: '2026-07-24',
    expected_return_date: '2026-07-30',
    actual_borrow_date: status === 'borrowed' || status === 'overdue' ? '2026-07-24' : null,
    actual_return_date: null,
    status,
    parent_request_id: null,
    rejection_reason: null,
    created_at: createdAt,
    updated_at: createdAt,
    requester: demoProfile,
    item,
    request_items: [
      {
        id: `${id}-line`,
        request_id: id,
        item_id: itemId,
        status: status === 'approved' ? 'reserved' : status === 'borrowed' || status === 'overdue' ? 'borrowed' : 'pending',
        actual_borrow_date: status === 'borrowed' || status === 'overdue' ? '2026-07-24' : null,
        actual_return_date: null,
        created_at: createdAt,
        updated_at: createdAt,
        item,
      },
    ],
  }
}

function createMovement(id, itemId, movementType, notes, createdAt) {
  return {
    id,
    item_id: itemId,
    movement_type: movementType,
    borrow_record_id: null,
    operator_id: DEMO_USER_ID,
    notes,
    created_at: createdAt,
    item: items.find((entry) => entry.id === itemId),
    operator: demoProfile,
  }
}

function getItemDetail(itemId) {
  const item = items.find((entry) => entry.id === itemId)
  if (!item) return null

  const hasBorrowHistory = ['borrowed', 'overdue'].includes(item.status)
  const borrowRecords = hasBorrowHistory
    ? [
        {
          id: `record-${itemId}`,
          request_id: recentRequests.find((request) => request.item_id === itemId)?.id || 'request-demo',
          request_item_id: null,
          item_id: itemId,
          borrower_id: DEMO_USER_ID,
          borrow_type: 'customer',
          borrow_date: '2026-07-24',
          due_date: item.status === 'overdue' ? '2026-07-26' : '2026-07-30',
          return_date: null,
          status: item.status === 'overdue' ? 'overdue' : 'active',
          overdue_days: item.status === 'overdue' ? 2 : 0,
          notes: '本地演示借用记录',
          created_at: '2026-07-24T10:00:00.000Z',
          updated_at: NOW,
          borrower: demoProfile,
          item,
        },
      ]
    : []

  return {
    item,
    borrowRecords,
    reservationLines: [],
    stockMovements: stockMovements.filter((movement) => movement.item_id === itemId),
  }
}

function getDashboardSummary() {
  const count = (status) => items.filter((item) => item.display_status === status).length
  return {
    total: items.length,
    inStock: count('in_stock'),
    reserved: count('reserved'),
    borrowed: count('borrowed'),
    overdue: count('overdue'),
    maintenance: count('maintenance'),
    retired: count('retired'),
    monthlyRequests: 6,
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 16_384) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function setCors(req, res) {
  const origin = req.headers.origin
  const allowedOrigins = new Set([
    'http://127.0.0.1:5175',
    'http://localhost:5175',
  ])
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function sendJson(req, res, status, payload) {
  setCors(req, res)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  setCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(req, res, 200, { ok: true, mode: 'local-demo' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readJson(req)
      if (body.email !== DEMO_EMAIL || body.password !== DEMO_PASSWORD) {
        sendJson(req, res, 401, { error: '演示账号或密码错误' })
        return
      }
      sendJson(req, res, 200, { user: demoUser, profile: demoProfile })
      return
    }

    if (req.method === 'GET' && url.pathname === '/auth/session') {
      sendJson(req, res, 200, { user: demoUser, profile: demoProfile })
      return
    }

    if (req.method === 'GET' && url.pathname === '/dashboard/summary') {
      sendJson(req, res, 200, getDashboardSummary())
      return
    }

    if (req.method === 'GET' && url.pathname === '/movements') {
      sendJson(req, res, 200, stockMovements)
      return
    }

    if (req.method === 'GET' && url.pathname === '/requests/recent') {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 5, 20))
      sendJson(req, res, 200, recentRequests.slice(0, limit))
      return
    }

    if (req.method === 'GET' && url.pathname === '/categories') {
      sendJson(req, res, 200, categories)
      return
    }

    if (req.method === 'GET' && url.pathname === '/items/reserved-ids') {
      sendJson(req, res, 200, items.filter((item) => item.display_status === 'reserved').map((item) => item.id))
      return
    }

    if (req.method === 'GET' && url.pathname === '/items') {
      const search = (url.searchParams.get('search') || '').trim().toLocaleLowerCase('zh-CN')
      const categoryId = url.searchParams.get('category_id') || ''
      const status = url.searchParams.get('status') || ''
      const borrowable = url.searchParams.get('borrowable') === '1'
      const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
      const pageSize = Math.max(1, Math.min(Number(url.searchParams.get('page_size')) || 50, 100))

      const filtered = items.filter((item) => {
        const matchesSearch = !search || [item.name, item.model, item.barcode, item.serial_number]
          .some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
        const matchesCategory = !categoryId || item.category_id === categoryId
        const matchesStatus = !status || item.display_status === status || item.status === status
        const matchesBorrowable = !borrowable || ['in_stock', 'borrowed'].includes(item.status)
        return matchesSearch && matchesCategory && matchesStatus && matchesBorrowable
      })

      const offset = (page - 1) * pageSize
      sendJson(req, res, 200, {
        data: filtered.slice(offset, offset + pageSize),
        count: filtered.length,
      })
      return
    }

    const detailMatch = url.pathname.match(/^\/items\/([^/]+)\/details$/)
    if (req.method === 'GET' && detailMatch) {
      const detail = getItemDetail(decodeURIComponent(detailMatch[1]))
      sendJson(req, res, detail ? 200 : 404, detail || { error: '样机不存在' })
      return
    }

    const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/)
    if (req.method === 'GET' && itemMatch) {
      const item = items.find((entry) => entry.id === decodeURIComponent(itemMatch[1]))
      sendJson(req, res, item ? 200 : 404, item || { error: '样机不存在' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/notifications') {
      sendJson(req, res, 200, notifications)
      return
    }

    if (req.method === 'GET' && url.pathname === '/notifications/unread-count') {
      sendJson(req, res, 200, { count: notifications.filter((notification) => !notification.is_read).length })
      return
    }

    const notificationMatch = url.pathname.match(/^\/notifications\/([^/]+)\/read$/)
    if (req.method === 'PATCH' && notificationMatch) {
      const notificationId = decodeURIComponent(notificationMatch[1])
      notifications = notifications.map((notification) => (
        notification.id === notificationId ? { ...notification, is_read: true } : notification
      ))
      sendJson(req, res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && url.pathname === '/notifications/read-all') {
      notifications = notifications.map((notification) => ({ ...notification, is_read: true }))
      sendJson(req, res, 200, { ok: true })
      return
    }

    sendJson(req, res, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(req, res, 500, {
      error: error instanceof Error ? error.message : 'Local demo server error',
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Local demo API ready at http://${HOST}:${PORT}`)
})
