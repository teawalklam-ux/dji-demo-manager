import * as XLSX from 'xlsx'
import type { Item, BorrowRecord, ApprovalRecord } from '@/types'
import { ITEM_STATUS_MAP, BORROW_TYPE_MAP } from '@/lib/constants'

function saveAsExcel(data: Record<string, string | number>[], filename: string, sheetName: string) {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export const exportService = {
  exportItemsToExcel(items: Item[]) {
    const data = items.map(item => ({
      '条码': item.barcode,
      '产品名称': item.name,
      '型号': item.model,
      '序列号': item.serial_number || '',
      '分类': item.category?.name || '',
      '状态': ITEM_STATUS_MAP[item.status]?.label || item.status,
      '存放位置': item.location || '',
      '当前借用人': item.current_borrower?.display_name || '',
      '购买日期': item.purchase_date || '',
      '购买价格': item.purchase_price || '',
      '备注': item.notes || '',
    }))
    saveAsExcel(data, `样机清单_${new Date().toISOString().split('T')[0]}`, '样机清单')
  },

  exportBorrowRecordsToExcel(records: BorrowRecord[]) {
    const data = records.map(record => ({
      '借用人': record.borrower?.display_name || '',
      '样机名称': record.item?.name || '',
      '样机型号': record.item?.model || '',
      '条码': record.item?.barcode || '',
      '借用类型': BORROW_TYPE_MAP[record.borrow_type]?.label || record.borrow_type,
      '借用日期': record.borrow_date,
      '应还日期': record.due_date,
      '实际归还日期': record.return_date || '',
      '状态': record.status === 'active' ? '借用中' : record.status === 'returned' ? '已归还' : '逾期',
      '逾期天数': record.overdue_days || 0,
      '备注': record.notes || '',
    }))
    saveAsExcel(data, `借用记录_${new Date().toISOString().split('T')[0]}`, '借用记录')
  },

  exportApprovalRecordsToExcel(records: ApprovalRecord[]) {
    const data = records.map(record => ({
      '审批人': record.approver?.display_name || '',
      '申请编号': record.request?.request_number || '',
      '申请人': record.request?.requester?.display_name || '',
      '样机名称': record.request?.item?.name || '',
      '审批步骤': `第${record.step_level}步`,
      '审批动作': record.action === 'approved' ? '同意' : record.action === 'rejected' ? '拒绝' : '待审批',
      '审批意见': record.comment || '',
      '审批时间': record.acted_at || '',
    }))
    saveAsExcel(data, `审批记录_${new Date().toISOString().split('T')[0]}`, '审批记录')
  },
}
