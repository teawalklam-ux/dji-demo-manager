import type {
  UserRole,
  UserStatus,
  ItemStatus,
  ItemDisplayStatus,
  BorrowType,
  BorrowRequestStatus,
  BorrowRecordStatus,
  MovementType,
  NotificationType,
  ApprovalAction,
  ApprovalStepType,
} from '@/lib/constants'

export type {
  UserRole,
  UserStatus,
  ItemStatus,
  ItemDisplayStatus,
  BorrowType,
  BorrowRequestStatus,
  BorrowRecordStatus,
  MovementType,
  NotificationType,
  ApprovalAction,
  ApprovalStepType,
}

// ===== 用户 =====
export interface Profile {
  id: string
  display_name: string
  email: string
  phone: string | null
  department: string | null
  role: UserRole
  avatar_url: string | null
  is_active: boolean
  status: UserStatus
  created_at: string
  updated_at: string
}

// ===== 分类 =====
export interface Category {
  id: string
  name: string
  code: string
  description: string | null
  icon_name: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

// ===== 样机 =====
export interface Item {
  id: string
  barcode: string
  name: string
  model: string
  serial_number: string | null
  category_id: string
  status: ItemStatus
  /** 列表展示状态；“预定”是根据未来已审批预约派生的状态。 */
  display_status?: ItemDisplayStatus
  /** 借用申请选择器中的可用状态与日期信息。 */
  availability_status?: 'in_stock' | 'reserved' | 'borrowed'
  reservation_start_date?: string | null
  reservation_end_date?: string | null
  current_due_date?: string | null
  /** 借用申请选择器中展示的 SN 后四位。 */
  serial_number_last4?: string | null
  specs: Record<string, string>
  purchase_date: string | null
  purchase_price: number | null
  notes: string | null
  image_url: string | null
  location: string | null
  current_borrower_id: string | null
  created_at: string
  updated_at: string
  // Joined
  category?: Category
  current_borrower?: Profile
}

export interface ItemCreateInput {
  name: string
  model: string
  serial_number?: string
  category_id: string
  specs?: Record<string, string>
  purchase_date?: string
  purchase_price?: number
  notes?: string
  image_url?: string
  location?: string
}

export interface ItemFilters {
  search?: string
  category_id?: string
  status?: ItemStatus
}

// ===== 借用申请 =====
export interface BorrowRequest {
  id: string
  request_number: string
  requester_id: string
  item_id: string
  borrow_type: BorrowType
  purpose: string
  customer_name: string | null
  customer_contact: string | null
  expected_borrow_date: string
  expected_return_date: string
  actual_borrow_date: string | null
  actual_return_date: string | null
  status: BorrowRequestStatus
  parent_request_id: string | null
  rejection_reason: string | null
  invalidated_at: string | null
  invalidation_reason: string | null
  created_at: string
  updated_at: string
  // Joined
  requester?: Profile
  item?: Item
  request_items?: BorrowRequestItem[]
  approval_records?: ApprovalRecord[]
}

export interface BorrowRequestInput {
  item_ids: string[]
  borrow_type: BorrowType
  purpose: string
  customer_name?: string
  customer_contact?: string
  expected_borrow_date: string
  expected_return_date: string
}

export interface BorrowRequestItem {
  id: string
  request_id: string
  item_id: string
  status: 'pending' | 'reserved' | 'borrowed' | 'returned' | 'cancelled' | 'invalidated'
  actual_borrow_date: string | null
  actual_return_date: string | null
  created_at: string
  updated_at: string
  item?: Item
}

export interface RenewInput {
  expected_return_date: string
  purpose?: string
}

// ===== 审批链 =====
export interface ApprovalStep {
  level: number
  type: ApprovalStepType
  role?: UserRole
  user_id?: string
  label: string
}

export interface ApprovalChain {
  id: string
  name: string
  borrow_type: BorrowType | 'all'
  steps: ApprovalStep[]
  max_borrow_days: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ===== 审批记录 =====
export interface ApprovalRecord {
  id: string
  request_id: string
  chain_id: string
  approver_id: string
  step_level: number
  action: ApprovalAction | null
  comment: string | null
  acted_at: string | null
  created_at: string
  // Joined
  approver?: Profile
  chain?: ApprovalChain
  request?: BorrowRequest
}

export interface ApprovalProgress {
  current_step: {
    step_level: number
    approver_id: string
    approver_name: string
    step_label: string | null
  }
  previous_step: {
    step_level: number
    approver_name: string
    action: ApprovalAction
    comment: string | null
    acted_at: string | null
  } | null
}

// ===== 借用记录 =====
export interface BorrowRecord {
  id: string
  request_id: string
  request_item_id: string | null
  item_id: string
  borrower_id: string
  borrow_type: BorrowType
  borrow_date: string
  due_date: string
  return_date: string | null
  status: BorrowRecordStatus
  overdue_days: number
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  borrower?: Profile
  item?: Item
  request?: BorrowRequest
}

// ===== 库存变动 =====
export interface StockMovement {
  id: string
  item_id: string
  movement_type: MovementType
  borrow_record_id: string | null
  operator_id: string
  notes: string | null
  created_at: string
  // Joined
  item?: Item
  operator?: Profile
}

// ===== 用户客户地址簿 =====
export interface UserCustomer {
  id: string
  user_id: string
  customer_name: string
  customer_contact: string | null
  created_at: string
  updated_at: string
  // Joined
  user?: Profile
}

// ===== 通知 =====
export type NotificationCategory = 'overdue' | 'approval' | 'return' | 'reservation'

export interface OverdueNotification {
  id: string
  borrow_record_id: string | null
  borrower_id: string | null
  notification_type: NotificationType
  notification_category: NotificationCategory
  recipient_id: string | null
  borrow_request_id: string | null
  message: string
  sent_at: string
  is_read: boolean
  // Joined
  borrow_record?: BorrowRecord
  borrow_request?: BorrowRequest
  recipient?: Profile
}

// ===== 归还照片 =====
export interface ReturnPhoto {
  id: string
  borrow_record_id: string
  uploader_id: string
  storage_path: string
  captured_at: string
  latitude: number | null
  longitude: number | null
  address: string | null
  photo_deleted_at: string | null
  created_at: string
  // Joined
  uploader?: Profile
  borrow_record?: BorrowRecord
}

// ===== 通用 =====
export interface PaginatedResponse<T> {
  data: T[]
  count: number
}

export interface RecordFilters {
  date_from?: string
  date_to?: string
  status?: string
  search?: string
}
