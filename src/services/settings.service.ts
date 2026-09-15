import { supabase } from '@/lib/supabase'
import { validateSettings, type SystemSettings } from '@/lib/system-settings'

const fields = 'barcode_prefix, default_borrow_days, overdue_remind_days, overdue_email_notify, overdue_wecom_notify'

export const settingsService = {
  async get(): Promise<SystemSettings> {
    const { data, error } = await supabase.from('system_settings').select(fields).eq('id', true).single()
    if (error) throw error
    return validateSettings(data)
  },
  async update(settings: SystemSettings): Promise<SystemSettings> {
    const { data, error } = await supabase.from('system_settings')
      .update(validateSettings(settings)).eq('id', true).select(fields).single()
    if (error) throw error
    return validateSettings(data)
  },
}
