import type { User } from '@supabase/supabase-js'
import type {
  BorrowRecord,
  BorrowRequest,
  BorrowRequestItem,
  Category,
  Item,
  OverdueNotification,
  PaginatedResponse,
  Profile,
  StockMovement,
} from '@/types'

export const DEMO_EMAIL = 'demo@local.test'
export const DEMO_PASSWORD = 'demo123456'
export const DEMO_API_URL = 'http://127.0.0.1:5176'

const DEMO_SESSION_KEY = 'dji-local-demo-session'

export const DEMO_ENABLED = import.meta.env.DEV

export interface DemoItemDetail {
  item: Item
  borrowRecords: BorrowRecord[]
  reservationLines: BorrowRequestItem[]
  stockMovements: StockMovement[]
}

interface DemoAuthResponse {
  user: User
  profile: Profile
}

interface DemoItemQuery {
  search?: string
  category_id?: string
  status?: string
  page?: number
  page_size?: number
  borrowable?: boolean
}

export function isDemoSessionActive() {
  if (!DEMO_ENABLED || typeof window === 'undefined') return false
  return window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1'
}

export function setDemoSessionActive(active: boolean) {
  if (!DEMO_ENABLED || typeof window === 'undefined') return
  if (active) {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, '1')
  } else {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY)
  }
}

async function demoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!DEMO_ENABLED) {
    throw new Error('本地演示模式仅在开发环境可用')
  }

  let response: Response
  try {
    response = await fetch(`${DEMO_API_URL}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('无法连接本地演示服务，请确认 5176 端口的演示 API 已启动')
  }

  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    throw new Error(payload.error || `本地演示服务返回 ${response.status}`)
  }
  return payload as T
}

function toSearchParams(query?: DemoItemQuery) {
  const params = new URLSearchParams()
  if (query?.search) params.set('search', query.search)
  if (query?.category_id) params.set('category_id', query.category_id)
  if (query?.status) params.set('status', query.status)
  if (query?.page) params.set('page', String(query.page))
  if (query?.page_size) params.set('page_size', String(query.page_size))
  if (query?.borrowable) params.set('borrowable', '1')
  const search = params.toString()
  return search ? `?${search}` : ''
}

export const demoApi = {
  login(email: string, password: string) {
    return demoFetch<DemoAuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  getSession() {
    return demoFetch<DemoAuthResponse>('/auth/session')
  },

  getDashboardSummary() {
    return demoFetch<{
      total: number
      inStock: number
      reserved: number
      borrowed: number
      overdue: number
      monthlyRequests: number
    }>('/dashboard/summary')
  },

  getMovements() {
    return demoFetch<StockMovement[]>('/movements')
  },

  getRecentRequests(limit = 5) {
    return demoFetch<BorrowRequest[]>(`/requests/recent?limit=${limit}`)
  },

  getCategories() {
    return demoFetch<Category[]>('/categories')
  },

  getItems(query?: DemoItemQuery) {
    return demoFetch<PaginatedResponse<Item>>(`/items${toSearchParams(query)}`)
  },

  getItem(id: string) {
    return demoFetch<Item>(`/items/${encodeURIComponent(id)}`)
  },

  getItemDetail(id: string) {
    return demoFetch<DemoItemDetail>(`/items/${encodeURIComponent(id)}/details`)
  },

  getReservedItemIds() {
    return demoFetch<string[]>('/items/reserved-ids')
  },

  getNotifications() {
    return demoFetch<OverdueNotification[]>('/notifications')
  },

  getUnreadCount() {
    return demoFetch<{ count: number }>('/notifications/unread-count')
  },

  markNotificationRead(id: string) {
    return demoFetch<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    })
  },

  markAllNotificationsRead() {
    return demoFetch<{ ok: boolean }>('/notifications/read-all', {
      method: 'POST',
    })
  },
}
