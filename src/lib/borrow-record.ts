import type { BorrowRecord } from '@/types'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Return the overdue days as of the user's current calendar date.
 * Active records are calculated too, because the scheduled overdue-status job
 * may not have run yet when the report is opened.
 */
export function getCurrentOverdueDays(
  record: Pick<BorrowRecord, 'status' | 'due_date' | 'overdue_days'>,
  today = new Date(),
): number {
  const storedDays = record.overdue_days || 0

  if (record.status === 'returned') return storedDays

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(record.due_date)
  if (!match) return storedDays

  const [, year, month, day] = match
  const dueDateUtc = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())

  return Math.max(0, Math.floor((todayUtc - dueDateUtc) / MILLISECONDS_PER_DAY))
}
