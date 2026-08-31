import { supabase } from '@/lib/supabase'

export type SopStageKey = 'materials' | 'workflow' | 'followup'
export type PersistedSopKind = 'operations' | 'system'
export type PersistedSopRole = 'user' | 'approver' | 'admin' | 'super_admin'
export type PersistedSopRoleGroup = 'user' | 'admin' | 'super_admin'

export interface PersistedSopItem {
  id: string
  label: string
}

export interface PersistedSopProcess {
  id: string
  kind: PersistedSopKind
  title: string
  description: string
  status: 'ready' | 'draft'
  icon_key: string
  required_role: PersistedSopRole | null
  role_group: PersistedSopRoleGroup | null
  entry_href: string | null
  entry_label: string | null
  stages: Record<SopStageKey, PersistedSopItem[]>
  sort_order: number
}

const LOCAL_PREVIEW_KEY = 'dji-sop-guide-preview-v1'

function readLocalPreview(): PersistedSopProcess[] {
  try {
    const value = window.localStorage.getItem(LOCAL_PREVIEW_KEY)
    if (!value) return []

    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as PersistedSopProcess[] : []
  } catch {
    return []
  }
}

export const sopService = {
  async getAll(options?: { localOnly?: boolean }): Promise<PersistedSopProcess[]> {
    if (options?.localOnly) return readLocalPreview()

    if (import.meta.env.DEV) {
      const { isDemoSessionActive } = await import('@/lib/demo-mode')
      if (isDemoSessionActive()) return []
    }

    const { data, error } = await supabase
      .from('sop_processes')
      .select('id, kind, title, description, status, icon_key, required_role, role_group, entry_href, entry_label, stages, sort_order')
      .order('sort_order')
      .order('id')

    if (error) throw error
    return (data ?? []) as PersistedSopProcess[]
  },

  async replaceAll(
    processes: PersistedSopProcess[],
    options?: { localOnly?: boolean },
  ): Promise<void> {
    if (options?.localOnly) {
      window.localStorage.setItem(LOCAL_PREVIEW_KEY, JSON.stringify(processes))
      return
    }

    const { error } = await supabase.rpc('replace_sop_processes', {
      p_processes: processes,
    })
    if (error) throw error
  },
}
