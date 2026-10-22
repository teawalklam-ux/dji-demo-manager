import type { PersistedSopItem } from '@/services/sop.service'

export const SYSTEM_GUIDE_IDS = [
  'system-crm-login', 'system-crm-customer', 'system-crm-followup',
  'system-borrow-apply', 'system-transfer-apply', 'system-renew-apply',
  'system-report-export', 'system-return-item', 'system-item-approval',
  'system-approval-chain', 'system-record-cleanup', 'system-request-history',
  'system-inventory-maintenance', 'system-user-management',
  'system-customer-address-book', 'system-global-settings',
  'system-super-admin-transfer', 'system-archive-audit',
] as const

/** Only raster data, same-site paths, and HTTPS images may be rendered. */
export function isSafeSopScreenshot(value: string): boolean {
  if (typeof value !== 'string') return false
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    || (/^\/(?!\/)/.test(value) && !/[\\\s]/.test(value))
    || (() => {
      try { return new URL(value).protocol === 'https:' } catch { return false }
    })()
}

export function getSopScreenshot(item: PersistedSopItem): string {
  if (item.screenshot !== undefined) return isSafeSopScreenshot(item.screenshot) ? item.screenshot : ''
  return ''
}
