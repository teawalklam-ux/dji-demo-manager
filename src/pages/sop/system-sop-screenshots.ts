import type { PersistedSopItem } from '@/services/sop.service'

export const SYSTEM_GUIDE_IDS = [
  'system-borrow-apply', 'system-transfer-apply', 'system-renew-apply',
  'system-report-export', 'system-return-item', 'system-item-approval',
  'system-approval-chain', 'system-record-cleanup', 'system-request-history',
  'system-inventory-maintenance', 'system-user-management',
  'system-customer-address-book', 'system-global-settings',
  'system-super-admin-transfer', 'system-archive-audit',
] as const

const bundledStepIds = new Set(SYSTEM_GUIDE_IDS.flatMap((id) => [
  `${id}-entry-1`, `${id}-entry-2`,
  `${id}-workflow-1`, `${id}-workflow-2`, `${id}-workflow-3`,
  `${id}-followup-1`, `${id}-followup-2`,
]))

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
  return bundledStepIds.has(item.id)
    ? `${import.meta.env.BASE_URL}sop-steps/${item.id}.jpg`
    : ''
}
