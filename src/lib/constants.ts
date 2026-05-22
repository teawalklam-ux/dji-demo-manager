// 用户角色
export type UserRole = 'admin' | 'approver' | 'user'

// 用户状态
export type UserStatus = 'pending_approval' | 'active' | 'disabled'

// 样机状态
export type ItemStatus = 'in_stock' | 'borrowed' | 'overdue' | 'maintenance' | 'retired'

// 借用类型
export type BorrowType = 'customer' | 'marketing'

// 借用申请状态
export type BorrowRequestStatus =
  | 'pending'
  | 'approved'
  | 'partially_approved'
  | 'rejected'
  | 'cancelled'
  | 'borrowed'
  | 'returned'
  | 'overdue'
  | 'renewal_requested'

// 借用记录状态
export type BorrowRecordStatus = 'active' | 'returned' | 'overdue'

// 库存变动类型
export type MovementType = 'borrow_out' | 'return_in' | 'new_entry' | 'maintenance' | 'retire'

// 通知类型
export type NotificationType = 'email' | 'push' | 'sms' | 'wecom'

// 审批动作
export type ApprovalAction = 'approved' | 'rejected'

// 审批步骤类型
export type ApprovalStepType = 'role' | 'person'

// ===== 状态映射 =====

type StatusInfo = { label: string; color: string }

export const ITEM_STATUS_MAP: Record<string, StatusInfo> = {
  in_stock: { label: '在库', color: 'bg-green-100 text-green-800' },
  borrowed: { label: '借出', color: 'bg-blue-100 text-blue-800' },
  overdue: { label: '逾期', color: 'bg-red-100 text-red-800' },
  maintenance: { label: '维修中', color: 'bg-orange-100 text-orange-800' },
  retired: { label: '已退役', color: 'bg-gray-100 text-gray-800' },
}

export const BORROW_TYPE_MAP: Record<string, StatusInfo> = {
  customer: { label: '客户试用', color: 'bg-purple-100 text-purple-800' },
  marketing: { label: '营销演示', color: 'bg-cyan-100 text-cyan-800' },
}

export const REQUEST_STATUS_MAP: Record<string, StatusInfo> = {
  pending: { label: '待审批', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '已通过', color: 'bg-green-100 text-green-800' },
  partially_approved: { label: '审批中', color: 'bg-blue-100 text-blue-800' },
  rejected: { label: '已拒绝', color: 'bg-red-100 text-red-800' },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-800' },
  borrowed: { label: '借用中', color: 'bg-blue-100 text-blue-800' },
  returned: { label: '已归还', color: 'bg-green-100 text-green-800' },
  overdue: { label: '已逾期', color: 'bg-red-100 text-red-800' },
  renewal_requested: { label: '续借申请', color: 'bg-orange-100 text-orange-800' },
}

export const ROLE_MAP: Record<string, StatusInfo> = {
  admin: { label: '管理员', color: 'bg-red-100 text-red-800' },
  approver: { label: '审批人', color: 'bg-blue-100 text-blue-800' },
  user: { label: '普通用户', color: 'bg-gray-100 text-gray-800' },
}

export const USER_STATUS_MAP: Record<string, StatusInfo> = {
  pending_approval: { label: '待审批', color: 'bg-yellow-100 text-yellow-800' },
  active: { label: '已启用', color: 'bg-green-100 text-green-800' },
  disabled: { label: '已禁用', color: 'bg-gray-100 text-gray-800' },
}

// 条码前缀
export const BARCODE_PREFIX = 'DJI'

// 默认借用天数
export const DEFAULT_BORROW_DAYS = 14
