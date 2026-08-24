import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { borrowService } from '@/services/borrow.service'
import { approvalService } from '@/services/approval.service'
import { customerService } from '@/services/customer.service'
import { toast } from 'sonner'
import type { Item, BorrowRequest, BorrowRequestInput, ApprovalChain, UserCustomer } from '@/types'
import { getBorrowTypeInfo, getBorrowTypeOptions, ITEM_STATUS_MAP } from '@/lib/constants'
import type { BorrowType } from '@/lib/constants'
import { getApplicableApprovalChain } from '@/lib/approval-chain'
import { canEditBorrowRequest } from '@/lib/borrow-request'
import { useAuth } from '@/contexts/auth-context'
import { getErrorMessage } from '@/lib/errors'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function getItemAvailabilityLabel(item: Item, isTransfer = false) {
  if (isTransfer && item.source_borrow_record_id) {
    const state = item.source_borrow_status === 'overdue' ? '逾期未还' : '借出中'
    const due = item.current_due_date ? `，应还 ${item.current_due_date}` : ''
    return `${state}${due}`
  }
  if (!['in_stock', 'borrowed'].includes(item.status)) {
    return ITEM_STATUS_MAP[item.status]?.label || item.status
  }
  if (item.availability_status === 'reserved') {
    return item.reservation_start_date && item.reservation_end_date
      ? `预定（${item.reservation_start_date} 至 ${item.reservation_end_date}）`
      : '预定'
  }
  if (item.availability_status === 'borrowed') {
    return item.current_due_date ? `借出（归还 ${item.current_due_date}）` : '借出'
  }
  return '在库'
}

function getItemAvailabilityClass(item: Item, isTransfer = false) {
  if (isTransfer && item.source_borrow_record_id) {
    return item.source_borrow_status === 'overdue'
      ? 'bg-red-100 text-red-800'
      : 'bg-blue-100 text-blue-800'
  }
  if (!['in_stock', 'borrowed'].includes(item.status)) {
    return ITEM_STATUS_MAP[item.status]?.color || 'bg-muted text-muted-foreground'
  }
  if (item.availability_status === 'reserved') return 'bg-violet-100 text-violet-800'
  if (item.availability_status === 'borrowed') return 'bg-blue-100 text-blue-800'
  return 'bg-green-100 text-green-800'
}

function getItemSerialLabel(item: Item) {
  const lastFour = item.serial_number_last4 || item.serial_number?.slice(-4)
  return lastFour ? `SN ****${lastFour}` : 'SN ----'
}

function isItemSelectable(item: Item, borrowType: BorrowType, sourceBorrowerId?: string | null) {
  if (borrowType === 'transfer') {
    return Boolean(
      item.source_borrow_record_id
      && item.source_borrower_id
      && (!sourceBorrowerId || item.source_borrower_id === sourceBorrowerId),
    )
  }
  return item.status === 'in_stock' || item.status === 'borrowed'
}

export function BorrowApply() {
  const navigate = useNavigate()
  const { itemId, requestId } = useParams<{ itemId: string; requestId: string }>()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingRequest, setEditingRequest] = useState<BorrowRequest | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [chains, setChains] = useState<ApprovalChain[]>([])

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(itemId ? [itemId] : [])
  const [searchQuery, setSearchQuery] = useState('')
  const [borrowType, setBorrowType] = useState<BorrowType>('customer')
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [saveCustomer, setSaveCustomer] = useState(true)
  const [customers, setCustomers] = useState<UserCustomer[]>([])
  const [purpose, setPurpose] = useState('')
  const [expectedBorrowDate, setExpectedBorrowDate] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [availabilityConflicts, setAvailabilityConflicts] = useState<Array<{ item_id: string; item_name: string; occupied_start_date: string; occupied_end_date: string }>>([])
  const [availabilityChecking, setAvailabilityChecking] = useState(false)
  const [availabilityCheckFailed, setAvailabilityCheckFailed] = useState(false)

  const selectedSourceBorrowerId = selectedItemIds
    .map((id) => items.find((item) => item.id === id)?.source_borrower_id)
    .find((id): id is string => Boolean(id))

  const candidateItems = items.filter((item) => (
    borrowType === 'transfer'
      ? Boolean(item.source_borrow_record_id)
      : item.status === 'in_stock' || item.status === 'borrowed'
  ))

  const filteredItems = candidateItems.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.serial_number_last4 && item.serial_number_last4.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [itemsData, transferableItemsData, chainsData, customersData, requestData] = await Promise.all([
        itemsService.getBorrowableItems(),
        itemsService.getTransferableItems(),
        approvalService.getChains(),
        customerService.getMine(),
        requestId ? borrowService.getRequestById(requestId) : Promise.resolve(null),
      ])
      const mergedItemMap = new Map(itemsData.map((item) => [item.id, item]))
      for (const transferItem of transferableItemsData) {
        mergedItemMap.set(transferItem.id, {
          ...mergedItemMap.get(transferItem.id),
          ...transferItem,
        } as Item)
      }
      const mergedAvailableItems = Array.from(mergedItemMap.values())

      setChains(chainsData.filter((c) => c.is_active))
      setCustomers(customersData)

      if (requestId) {
        if (!requestData) {
          setItems(mergedAvailableItems)
          setLoadError('未找到申请，或当前账号没有查看权限。')
          return
        }
        if (!canEditBorrowRequest(requestData, user?.id)) {
          setItems(mergedAvailableItems)
          setLoadError('该申请已进入审批或处理流程，不能再编辑。')
          return
        }

        const mergedItems = [...mergedAvailableItems]
        for (const line of requestData.request_items || []) {
          if (line.item && !mergedItems.some((item) => item.id === line.item!.id)) {
            mergedItems.push(line.item)
          }
        }

        setItems(mergedItems)
        setEditingRequest(requestData)
        setSelectedItemIds((requestData.request_items || []).map((line) => line.item_id))
        setBorrowType(requestData.borrow_type)
        setPurpose(requestData.purpose || '')
        setCustomerName(requestData.customer_name || '')
        setCustomerContact(requestData.customer_contact || '')
        setExpectedBorrowDate(requestData.expected_borrow_date)
        setExpectedReturnDate(requestData.expected_return_date)
        setSaveCustomer(false)
      } else {
        setItems(mergedAvailableItems)
        const initialItem = itemId ? mergedAvailableItems.find((item) => item.id === itemId) : null
        if (itemId && !initialItem) {
          setSelectedItemIds([])
          toast.error('该样机当前不可申请借用或转借')
        } else if (initialItem?.source_borrow_record_id) {
          setBorrowType('transfer')
          setExpectedBorrowDate(new Date().toLocaleDateString('en-CA'))
        }
      }
    } catch (error) {
      toast.error('加载数据失败')
      setLoadError(getErrorMessage(error, '申请表单加载失败，请稍后重试。'))
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [itemId, requestId, user?.id])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  useEffect(() => {
    if (borrowType === 'transfer') {
      setAvailabilityConflicts([])
      setAvailabilityChecking(false)
      setAvailabilityCheckFailed(false)
      return
    }
    if (loadError || !expectedBorrowDate || !expectedReturnDate || expectedReturnDate < expectedBorrowDate || selectedItemIds.length === 0) {
      setAvailabilityConflicts([])
      setAvailabilityChecking(false)
      setAvailabilityCheckFailed(false)
      return
    }
    let cancelled = false
    setAvailabilityChecking(true)
    setAvailabilityCheckFailed(false)
    borrowService.checkAvailability(selectedItemIds, expectedBorrowDate, expectedReturnDate, requestId)
      .then((conflicts) => {
        if (!cancelled) {
          setAvailabilityConflicts(conflicts)
          setAvailabilityCheckFailed(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAvailabilityConflicts([])
          setAvailabilityCheckFailed(true)
          console.error('预检样机可用性失败:', error)
        }
      })
      .finally(() => {
        if (!cancelled) setAvailabilityChecking(false)
      })
    return () => { cancelled = true }
  }, [selectedItemIds, expectedBorrowDate, expectedReturnDate, requestId, loadError, borrowType])

  useEffect(() => {
    if (loading || editingRequest) return

    if (borrowType === 'transfer') {
      const today = new Date().toLocaleDateString('en-CA')
      setExpectedBorrowDate(today)
      setSelectedItemIds((current) => current.filter((id) => {
        const item = items.find((candidate) => candidate.id === id)
        return Boolean(item?.source_borrow_record_id)
      }))
      return
    }

    setSelectedItemIds((current) => current.filter((id) => {
      const item = items.find((candidate) => candidate.id === id)
      return Boolean(item && ['in_stock', 'borrowed'].includes(item.status))
    }))
  }, [borrowType, editingRequest, items, loading])

  const activeChains = chains.filter((chain) => chain.is_active)
  const borrowTypeOptions = getBorrowTypeOptions(activeChains.map(chain => chain.borrow_type))
  const currentChain = getApplicableApprovalChain(chains, borrowType)
  const borrowTypeInfo = getBorrowTypeInfo(borrowType)

  const approvalPreviewSteps = borrowType === 'transfer' && currentChain
    ? [
        { level: 1, type: 'person' as const, label: '当前借用人确认' },
        ...currentChain.steps.map((step) => ({ ...step, level: step.level + 1 })),
      ]
    : currentChain?.steps || []

  const maxBorrowDays = currentChain?.max_borrow_days ?? null

  const borrowDays = expectedBorrowDate && expectedReturnDate
    ? Math.ceil((new Date(expectedReturnDate).getTime() - new Date(expectedBorrowDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0

  const exceedsMaxDays = maxBorrowDays !== null && borrowDays > maxBorrowDays

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId)
    if (customerId && customerId !== '__new') {
      const c = customers.find((c) => c.id === customerId)
      if (c) {
        setCustomerName(c.customer_name)
        setCustomerContact(c.customer_contact || '')
      }
    } else {
      setCustomerName('')
      setCustomerContact('')
    }
  }

  const addItem = (id: string) => {
    const item = items.find((candidate) => candidate.id === id)
    if (!item || !isItemSelectable(item, borrowType, selectedSourceBorrowerId)) {
      toast.error(borrowType === 'transfer' ? '同一张转借申请只能选择同一当前借用人的设备' : '该设备当前不可申请')
      return
    }
    setSelectedItemIds((current) => current.includes(id) ? current : [...current, id])
  }

  const removeItem = (id: string) => {
    setSelectedItemIds((current) => current.filter((itemId) => itemId !== id))
  }

  const handleSubmit = async () => {
    if (borrowType === 'transfer' && !currentChain) {
      toast.error('转借审批链未启用，暂时无法提交转借申请')
      return
    }
    if (selectedItemIds.length === 0) {
      toast.error('请至少选择一台样机')
      return
    }
    if (selectedItemIds.some((id) => {
      const item = items.find((candidate) => candidate.id === id)
      return !item || !isItemSelectable(item, borrowType, selectedSourceBorrowerId)
    })) {
      toast.error('已选样机中包含当前不可申请的设备，请移除后再保存')
      return
    }
    if (borrowType === 'transfer') {
      const sourceBorrowerIds = new Set(selectedItemIds.map((id) => (
        items.find((candidate) => candidate.id === id)?.source_borrower_id
      )))
      if (sourceBorrowerIds.size !== 1 || sourceBorrowerIds.has(undefined)) {
        toast.error('同一张转借申请中的设备必须属于同一当前借用人')
        return
      }
    }
    if (!purpose.trim()) {
      toast.error('请填写借用用途')
      return
    }
    if (!expectedBorrowDate) {
      toast.error('请选择预计借用日期')
      return
    }
    if (!expectedReturnDate) {
      toast.error('请选择预计归还日期')
      return
    }
    if (expectedReturnDate < expectedBorrowDate) {
      toast.error('归还日期不能早于借用日期')
      return
    }
    if (exceedsMaxDays) {
      toast.error(`${borrowTypeInfo.label}最多可申请 ${maxBorrowDays} 天，当前为 ${borrowDays} 天`)
      return
    }
    if (availabilityConflicts.length > 0) {
      toast.error('所选日期已有审批通过的样机预约，请调整样机或日期')
      return
    }
    if (availabilityChecking || availabilityCheckFailed) {
      toast.error(availabilityChecking ? '正在校验样机可用性，请稍候' : '样机可用性校验失败，请刷新后重试')
      return
    }
    if (borrowType === 'customer' || borrowType === 'transfer') {
      if (!customerName.trim()) {
        toast.error('请填写客户名称')
        return
      }
    }
    if (borrowType === 'customer') {
      if (!customerContact.trim()) {
        toast.error('请填写客户联系方式')
        return
      }
    }

    setSubmitting(true)
    try {
      const input: BorrowRequestInput = {
        item_ids: selectedItemIds,
        borrow_type: borrowType,
        purpose: purpose.trim(),
        customer_name: ['customer', 'transfer'].includes(borrowType) ? customerName.trim() : undefined,
        customer_contact: borrowType === 'customer' ? customerContact.trim() : undefined,
        expected_borrow_date: expectedBorrowDate,
        expected_return_date: expectedReturnDate,
      }
      if (requestId) {
        await borrowService.updateRequest(requestId, input)
      } else {
        await borrowService.createRequest(input)
      }
      // 保存客户到地址簿（异步，不阻塞跳转）
      if (borrowType === 'customer' && saveCustomer && customerName.trim()) {
        customerService.save(customerName.trim(), customerContact.trim()).catch(console.error)
      }
      toast.success(requestId ? '申请已更新' : borrowType === 'transfer' ? '转借申请已提交' : '借用申请已提交')
      navigate(requestId ? `/borrow/requests/${requestId}` : '/borrow/my-requests')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, requestId ? '申请更新失败' : '提交失败'))
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 p-6">
        <Card>
          <CardContent className="flex min-h-48 flex-col items-start justify-center gap-3 p-6">
            <h1 className="text-xl font-semibold">无法编辑申请</h1>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <div className="flex flex-wrap gap-2">
              {requestId && (
                <Button onClick={() => navigate(`/borrow/requests/${requestId}`)}>返回申请详情</Button>
              )}
              <Button variant="outline" onClick={() => navigate('/borrow/my-requests')}>返回我的申请</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{requestId ? '编辑申请' : '借用申请'}</h1>
        <p className="text-muted-foreground mt-1">
          {requestId
            ? `修改 ${editingRequest?.request_number || ''}；保存后会按最新信息重新建立未处理的审批步骤`
            : '填写借用信息，提交审批流程'}
        </p>
      </div>

      {/* 样机选择 */}
      <Card>
        <CardHeader>
          <CardTitle>选择样机</CardTitle>
          <CardDescription>
            {borrowType === 'transfer'
              ? '选择同一当前借用人的借出或逾期设备；最终审批通过后立即完成保管权交接'
              : '选择在申请日期内无冲突的样机；正常借出设备可申请未来日期，逾期设备不可预约'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="搜索样机名称、型号、条码或SN码后四位..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Select onValueChange={addItem}>
            <SelectTrigger>
              <SelectValue placeholder="请选择样机" />
            </SelectTrigger>
            <SelectContent>
              {filteredItems.filter((item) => (
                !selectedItemIds.includes(item.id)
                && isItemSelectable(item, borrowType, selectedSourceBorrowerId)
              )).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">
                      {item.name} - {item.model}
                      {item.category ? ` (${item.category.name})` : ''}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {getItemSerialLabel(item)}
                    </span>
                    {borrowType === 'transfer' && item.source_borrower_name && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        当前：{item.source_borrower_name}
                      </span>
                    )}
                    <Badge className={`${getItemAvailabilityClass(item, borrowType === 'transfer')} shrink-0 text-xs`}>
                      {getItemAvailabilityLabel(item, borrowType === 'transfer')}
                    </Badge>
                  </span>
                </SelectItem>
              ))}
              {filteredItems.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {borrowType === 'transfer' ? '未找到可转借设备' : '未找到可预约样机'}
                </div>
              )}
            </SelectContent>
          </Select>
          {selectedItemIds.length > 0 && (
            <div className="space-y-2 rounded-md bg-muted/50 p-3">
              <div className="text-sm font-medium">已选 {selectedItemIds.length} 台样机</div>
              {selectedItemIds.map((id) => {
                const selectedItem = items.find((item) => item.id === id)
                if (!selectedItem) return null
                return (
                  <div key={id} className="flex items-center justify-between gap-3 rounded border bg-background px-3 py-2 text-sm">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-medium">{selectedItem.name}</span>
                      <span className="text-muted-foreground">{selectedItem.model} · {selectedItem.barcode}</span>
                      <span className="font-mono text-xs text-muted-foreground">{getItemSerialLabel(selectedItem)}</span>
                      {borrowType === 'transfer' && selectedItem.source_borrower_name && (
                        <span className="text-xs text-muted-foreground">
                          当前借用人：{selectedItem.source_borrower_name}
                        </span>
                      )}
                      <Badge className={`${getItemAvailabilityClass(selectedItem, borrowType === 'transfer')} text-xs`}>
                        {getItemAvailabilityLabel(selectedItem, borrowType === 'transfer')}
                      </Badge>
                      {!isItemSelectable(selectedItem, borrowType, selectedSourceBorrowerId) && (
                        <span className="text-xs text-destructive">当前不可申请，请移除后再保存</span>
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(id)}>移除</Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 借用类型 */}
      <Card>
        <CardHeader>
          <CardTitle>借用类型</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={borrowType}
            onValueChange={(v) => setBorrowType(v as BorrowType)}
            className="flex flex-wrap gap-x-6 gap-y-3"
          >
            {borrowTypeOptions.map(option => {
              const inputId = `borrow-type-${encodeURIComponent(option.value)}`
              return (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.value} id={inputId} />
                  <Label htmlFor={inputId} className="cursor-pointer">
                    {option.label}
                  </Label>
                </div>
              )
            })}
          </RadioGroup>

          {borrowType === 'transfer' && (
            <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              转借仅适用于其他人当前借出或逾期未还的设备。同一申请可选择多台设备，但必须属于同一当前借用人。
            </div>
          )}

          {(borrowType === 'customer' || borrowType === 'transfer') && (
            <div className="mt-4 space-y-4">
              {customers.length > 0 && (
                <div className="space-y-2">
                  <Label>从地址簿选择</Label>
                  <Select value={selectedCustomerId} onValueChange={handleSelectCustomer}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择已保存的客户快速填充" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new">+ 手动输入新客户</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.customer_name}{c.customer_contact ? ` (${c.customer_contact})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="customerName">客户名称 *</Label>
                <Input
                  id="customerName"
                  placeholder="请输入客户名称"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value)
                    setSelectedCustomerId('')
                  }}
                />
              </div>
              {borrowType === 'customer' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="customerContact">客户联系方式 *</Label>
                    <Input
                      id="customerContact"
                      placeholder="请输入客户联系方式"
                      value={customerContact}
                      onChange={(e) => {
                        setCustomerContact(e.target.value)
                        setSelectedCustomerId('')
                      }}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="saveCustomer"
                      checked={saveCustomer}
                      onCheckedChange={(v) => setSaveCustomer(v === true)}
                    />
                    <Label htmlFor="saveCustomer" className="cursor-pointer text-sm text-muted-foreground">
                      保存到客户地址簿，下次可直接选择
                    </Label>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 借用详情 */}
      <Card>
        <CardHeader>
          <CardTitle>借用详情</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="purpose">借用用途 *</Label>
            <Textarea
              id="purpose"
              placeholder="请详细描述借用用途"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="borrowDate">
                {borrowType === 'transfer' ? '转借生效日期' : '预计借用日期 *'}
              </Label>
              <Input
                id="borrowDate"
                type="date"
                min={new Date().toLocaleDateString('en-CA')}
                value={expectedBorrowDate}
                onChange={(e) => setExpectedBorrowDate(e.target.value)}
                disabled={borrowType === 'transfer'}
              />
              {borrowType === 'transfer' && (
                <p className="text-xs text-muted-foreground">实际以最终审批通过当天为准</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="returnDate">预计归还日期 *</Label>
              <Input
                id="returnDate"
                type="date"
                min={expectedBorrowDate || new Date().toLocaleDateString('en-CA')}
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
              />
            </div>
          </div>
          {availabilityConflicts.length > 0 && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              <div className="font-medium">以下样机在所选日期已审批通过，无法申请：</div>
              <ul className="mt-1 list-disc pl-5">
                {availabilityConflicts.map((conflict) => (
                  <li key={conflict.item_id}>{conflict.item_name}（{conflict.occupied_start_date} 至 {conflict.occupied_end_date}）</li>
                ))}
              </ul>
            </div>
          )}
          {availabilityCheckFailed && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              无法确认所选样机的可用性。为避免重复预约，本次申请已暂停提交，请刷新后重试。
            </div>
          )}
          {borrowType === 'transfer' && selectedItemIds.length > 0 && (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">
              系统会在提交和最终审批时再次校验设备归属及未来预约；任一设备状态发生变化时整张转借申请不会部分执行。
            </div>
          )}
          {maxBorrowDays !== null && (
            <div className={`rounded-md p-3 text-sm ${exceedsMaxDays ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
              {borrowTypeInfo.label}最多可申请 <strong>{maxBorrowDays}</strong> 天
              {borrowDays > 0 && (
                <span className="ml-2">
                  当前: <strong>{borrowDays}</strong> 天
                  {exceedsMaxDays && ' (已超出)'}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 审批流程预览 */}
      <Card>
        <CardHeader>
          <CardTitle>审批流程预览</CardTitle>
          <CardDescription>
            当前类型: <Badge variant="secondary">{borrowTypeInfo.label}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentChain ? (
            <div className="space-y-3">
              {approvalPreviewSteps.map((step, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                    {step.level}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {step.type === 'role' ? '角色审批' : '指定人员审批'}
                    </div>
                  </div>
                  {index < approvalPreviewSteps.length - 1 && (
                    <div className="ml-4 h-6 w-px bg-border" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {borrowType === 'transfer' ? '转借审批链未启用，暂时无法提交转借申请' : '暂无对应审批流程配置'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 提交按钮 */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          取消
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            submitting
            || availabilityChecking
            || availabilityCheckFailed
            || availabilityConflicts.length > 0
            || (borrowType === 'transfer' && !currentChain)
          }
        >
          {submitting && <Spinner className="mr-2 size-4" />}
          {requestId ? '保存修改' : '提交申请'}
        </Button>
      </div>
    </div>
  )
}
