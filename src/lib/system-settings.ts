export interface SystemSettings {
  barcode_prefix: string
  default_borrow_days: number
  overdue_remind_days: number
  overdue_email_notify: boolean
  overdue_wecom_notify: boolean
}

export const defaultSettings: SystemSettings = {
  barcode_prefix: 'DJI',
  default_borrow_days: 14,
  overdue_remind_days: 1,
  overdue_email_notify: true,
  overdue_wecom_notify: false,
}

// Explicit whitelist: never persist legacy Webhook URLs or arbitrary fields.
export function validateSettings(value: SystemSettings): SystemSettings {
  const prefix = value.barcode_prefix.trim()
  if (!prefix || prefix.length > 32) throw new Error('条码前缀须为 1–32 个字符')
  if (!Number.isInteger(value.default_borrow_days) || value.default_borrow_days < 1 || value.default_borrow_days > 3650) {
    throw new Error('默认借用天数须为 1–3650 的整数')
  }
  if (!Number.isInteger(value.overdue_remind_days) || value.overdue_remind_days < 0 || value.overdue_remind_days > 3650) {
    throw new Error('逾期提醒天数须为 0–3650 的整数')
  }
  if (typeof value.overdue_email_notify !== 'boolean' || typeof value.overdue_wecom_notify !== 'boolean') {
    throw new Error('通知开关必须为布尔值')
  }
  return {
    barcode_prefix: prefix,
    default_borrow_days: value.default_borrow_days,
    overdue_remind_days: value.overdue_remind_days,
    overdue_email_notify: value.overdue_email_notify,
    overdue_wecom_notify: value.overdue_wecom_notify,
  }
}

export function defaultReturnDate(borrowDate: string, days: number): string {
  if (!borrowDate) return ''
  const date = new Date(`${borrowDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
