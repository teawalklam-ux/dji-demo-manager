import { supabase } from '@/lib/supabase'

export const APP_LOG_LEVELS = ['info', 'warn', 'error'] as const
export const APP_LOG_CATEGORIES = ['navigation', 'ui', 'api', 'business', 'system'] as const

export type AppLogLevel = (typeof APP_LOG_LEVELS)[number]
export type AppLogCategory = (typeof APP_LOG_CATEGORIES)[number]

export interface AppLogActor {
  display_name: string
  department: string | null
}

export interface AppLogEntry {
  id: string
  actor_id: string | null
  level: AppLogLevel
  category: AppLogCategory
  event: string
  message: string
  route: string | null
  correlation_id: string
  context: Record<string, string>
  client_occurred_at: string
  created_at: string
  actor: AppLogActor | null
}

export interface AppLogFilters {
  search?: string
  level?: AppLogLevel | 'all'
  category?: AppLogCategory | 'all'
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

interface WriteAppLogInput {
  level: AppLogLevel
  category: AppLogCategory
  event: string
  message?: string
  route?: string
  context?: Record<string, unknown>
}

const SESSION_KEY = 'dji-app-log-correlation-id'
const PAGE_VIEW_KEY_PREFIX = 'dji-app-log-page-views:'
const ALLOWED_CONTEXT_KEYS = new Set([
  'component',
  'operation',
  'error_name',
  'stack',
  'filename',
  'line',
  'column',
  'status_code',
  'method',
  'duration_ms',
])
const SENSITIVE_KEY = /(password|passwd|token|secret|authorization|cookie|api[_-]?key|credential|session)/i
const RECENT_FINGERPRINTS = new Map<string, number>()
const MAX_RECENT_FINGERPRINTS = 100
const DEDUPE_WINDOW_MS = 60_000

function isLocalDemoSession() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem('dji-local-demo-session') === '1'
  } catch {
    return false
  }
}

function redactText(value: unknown, maxLength: number): string {
  const text = String(value ?? '')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/gi, '[REDACTED]')
    .replace(/([?&](?:token|key|secret|password|code)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[EMAIL]')
    .replace(/(^|\D)1[3-9]\d{9}(?=\D|$)/g, '$1[PHONE]')
  return text.slice(0, maxLength)
}

function cleanRoute(value?: string): string | null {
  if (typeof window === 'undefined' && !value) return null
  const route = value || window.location.pathname
  return route.split(/[?#]/, 1)[0].slice(0, 240) || null
}

function normalizeContext(context: Record<string, unknown> = {}) {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key) || SENSITIVE_KEY.test(key) || value == null) continue
    const limit = key === 'stack' ? 1200 : key === 'filename' ? 240 : 100
    const safeValue = redactText(value, limit)
    if (safeValue) normalized[key] = safeValue
  }
  return normalized
}

function getCorrelationId() {
  if (typeof window === 'undefined') return crypto.randomUUID()
  try {
    const current = window.sessionStorage.getItem(SESSION_KEY)
    if (current) return current
    const next = crypto.randomUUID()
    window.sessionStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

function shouldTrackPageView(actorId: string, route: string) {
  if (typeof window === 'undefined') return true
  const storageKey = `${PAGE_VIEW_KEY_PREFIX}${actorId}`
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || '[]')
    const visitedRoutes = Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === 'string').slice(-99)
      : []
    if (visitedRoutes.includes(route)) return false
    window.sessionStorage.setItem(storageKey, JSON.stringify([...visitedRoutes, route]))
    return true
  } catch {
    return true
  }
}

export function resetAppLogSession() {
  RECENT_FINGERPRINTS.clear()
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
    const pageViewKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(PAGE_VIEW_KEY_PREFIX)))
    pageViewKeys.forEach((key) => window.sessionStorage.removeItem(key))
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function isDuplicate(input: WriteAppLogInput) {
  const now = Date.now()
  const fingerprint = `${input.level}:${input.category}:${input.event}:${input.message || ''}:${cleanRoute(input.route)}`
  const previous = RECENT_FINGERPRINTS.get(fingerprint)
  RECENT_FINGERPRINTS.set(fingerprint, now)

  if (RECENT_FINGERPRINTS.size > MAX_RECENT_FINGERPRINTS) {
    for (const [key, timestamp] of RECENT_FINGERPRINTS) {
      if (now - timestamp > DEDUPE_WINDOW_MS) RECENT_FINGERPRINTS.delete(key)
    }
    while (RECENT_FINGERPRINTS.size > MAX_RECENT_FINGERPRINTS) {
      const oldestKey = RECENT_FINGERPRINTS.keys().next().value as string | undefined
      if (!oldestKey) break
      RECENT_FINGERPRINTS.delete(oldestKey)
    }
  }

  return previous !== undefined && now - previous < DEDUPE_WINDOW_MS
}

function sanitizeSearch(value?: string) {
  return value?.trim().replace(/[,().%"']/g, ' ').replace(/\s+/g, ' ').slice(0, 80) || ''
}

function csvCell(value: unknown) {
  const rawText = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  const text = /^[=+\-@\t\r]/.test(rawText) ? `'${rawText}` : rawText
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(rows: AppLogEntry[]) {
  const header = ['时间', '等级', '分类', '事件', '消息', '页面', '用户', '部门', '关联 ID', '上下文']
  const body = rows.map((row) => [
    row.created_at,
    row.level,
    row.category,
    row.event,
    row.message,
    row.route,
    row.actor?.display_name,
    row.actor?.department,
    row.correlation_id,
    row.context,
  ].map(csvCell).join(','))
  const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...body].join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function queryLogs(filters: AppLogFilters, exportMode = false) {
  const pageSize = exportMode ? 1000 : Math.min(Math.max(filters.pageSize || 30, 1), 100)
  const page = Math.max(filters.page || 1, 1)
  const start = exportMode ? 0 : (page - 1) * pageSize
  const end = exportMode ? pageSize - 1 : start + pageSize - 1

  let query = supabase
    .from('app_logs')
    .select(`
      id,
      actor_id,
      level,
      category,
      event,
      message,
      route,
      correlation_id,
      context,
      client_occurred_at,
      created_at,
      actor:profiles!app_logs_actor_id_fkey(display_name, department)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filters.level && filters.level !== 'all') query = query.eq('level', filters.level)
  if (filters.category && filters.category !== 'all') query = query.eq('category', filters.category)
  if (filters.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00`)
  if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59.999`)

  const search = sanitizeSearch(filters.search)
  if (search) query = query.or(`event.ilike.%${search}%,message.ilike.%${search}%`)

  const { data, error, count } = await query.range(start, end)
  if (error) throw error
  return { data: (data || []) as unknown as AppLogEntry[], count: count || 0 }
}

export const appLogService = {
  async write(input: WriteAppLogInput) {
    if (isLocalDemoSession() || isDuplicate(input)) return

    try {
      const { error } = await supabase.from('app_logs').insert({
        level: input.level,
        category: input.category,
        event: redactText(input.event, 80).trim(),
        message: redactText(input.message, 500),
        route: cleanRoute(input.route),
        correlation_id: getCorrelationId(),
        context: normalizeContext(input.context),
        client_occurred_at: new Date().toISOString(),
      })

      if (error && import.meta.env.DEV) {
        console.warn('[app-log] write skipped:', error.message)
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[app-log] write skipped:', error instanceof Error ? error.message : '未知错误')
      }
    }
  },

  info(category: AppLogCategory, event: string, message?: string, context?: Record<string, unknown>) {
    return this.write({ level: 'info', category, event, message, context })
  },

  warn(category: AppLogCategory, event: string, message?: string, context?: Record<string, unknown>) {
    return this.write({ level: 'warn', category, event, message, context })
  },

  trackPageView(route: string, actorId: string) {
    const cleanPath = cleanRoute(route)
    if (!cleanPath || !shouldTrackPageView(actorId, cleanPath)) return Promise.resolve()
    return this.write({
      level: 'info',
      category: 'navigation',
      event: 'page_view',
      message: '打开系统页面',
      route: cleanPath,
      context: { component: 'router', operation: cleanPath },
    })
  },

  captureError(error: unknown, input: Omit<WriteAppLogInput, 'level' | 'message'> & { message?: string }) {
    const normalized = error instanceof Error ? error : new Error(String(error || '未知错误'))
    return this.write({
      ...input,
      level: 'error',
      message: input.message || normalized.message,
      context: {
        ...input.context,
        error_name: normalized.name,
        stack: normalized.stack,
      },
    })
  },

  list(filters: AppLogFilters) {
    return queryLogs(filters)
  },

  async export(filters: AppLogFilters) {
    const result = await queryLogs(filters, true)
    if (result.data.length > 0) downloadCsv(result.data)
    return result.data.length
  },
}

let handlersInstalled = false

export function installAppLogHandlers() {
  if (handlersInstalled || typeof window === 'undefined') return
  handlersInstalled = true

  const originalConsoleError = console.error.bind(console)
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now()
    const request = input instanceof Request ? input : null
    const method = (init?.method || request?.method || 'GET').toUpperCase()
    let url: URL | null = null
    try {
      url = new URL(request?.url || String(input), window.location.origin)
    } catch {
      // A non-standard fetch implementation can still proceed without logging.
    }
    const isLogWrite = url?.pathname.endsWith('/rest/v1/app_logs') ?? false

    try {
      const response = await originalFetch(input, init)
      const durationMs = Math.round(performance.now() - startedAt)
      if (!isLogWrite && !response.ok) {
        void appLogService.write({
          level: 'error',
          category: 'api',
          event: 'api_request_failed',
          message: `接口返回 ${response.status}`,
          context: {
            operation: url?.pathname,
            method,
            status_code: response.status,
            duration_ms: durationMs,
          },
        })
      } else if (!isLogWrite && durationMs >= 5_000) {
        void appLogService.warn('api', 'slow_request', '接口响应超过 5 秒', {
          operation: url?.pathname,
          method,
          status_code: response.status,
          duration_ms: durationMs,
        })
      }
      return response
    } catch (error) {
      if (!isLogWrite) {
        void appLogService.captureError(error, {
          category: 'api',
          event: 'api_network_error',
          context: {
            operation: url?.pathname,
            method,
            duration_ms: Math.round(performance.now() - startedAt),
          },
        })
      }
      throw error
    }
  }

  console.error = (...args: unknown[]) => {
    originalConsoleError(...args)
    const error = args.find((value): value is Error => value instanceof Error)
    const message = args
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .map(String)
      .join(' ')
    void appLogService.captureError(error || new Error(message || '控制台错误'), {
      category: 'system',
      event: 'console_error',
      message,
      context: { component: 'console' },
    })
  }

  window.addEventListener('error', (event) => {
    void appLogService.captureError(event.error || new Error(event.message), {
      category: 'system',
      event: 'window_error',
      context: {
        component: 'window',
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void appLogService.captureError(event.reason, {
      category: 'system',
      event: 'unhandled_rejection',
      context: { component: 'promise' },
    })
  })
}
