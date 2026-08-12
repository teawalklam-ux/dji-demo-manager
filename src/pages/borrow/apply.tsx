import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { borrowService } from '@/services/borrow.service'
import { approvalService } from '@/services/approval.service'
import { customerService } from '@/services/customer.service'
import { toast } from 'sonner'
import type { Item, BorrowRequestInput, ApprovalChain, UserCustomer } from '@/types'
import { getBorrowTypeInfo, getBorrowTypeOptions } from '@/lib/constants'
import type { BorrowType } from '@/lib/constants'

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

function getItemAvailabilityLabel(item: Item) {
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

function getItemAvailabilityClass(item: Item) {
  if (item.availability_status === 'reserved') return 'bg-violet-100 text-violet-800'
  if (item.availability_status === 'borrowed') return 'bg-blue-100 text-blue-800'
  return 'bg-green-100 text-green-800'
}

function getItemSerialLabel(item: Item) {
  return item.serial_number_last4 ? `SN ****${item.serial_number_last4}` : 'SN ----'
}

export function BorrowApply() {
  const navigate = useNavigate()
  const { itemId } = useParams<{ itemId: string }>()

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.serial_number_last4 && item.serial_number_last4.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsData, chainsData, customersData] = await Promise.all([
        itemsService.getBorrowableItems(),
        approvalService.getChains(),
        customerService.getMine(),
      ])
      setItems(itemsData)
      if (itemId && !itemsData.some((item) => item.id === itemId)) {
        setSelectedItemIds([])
        toast.error('该样机当前为逾期、维修或退役状态，不能提交预约申请')
      }
      setChains(chainsData.filter((c) => c.is_active))
      setCustomers(customersData)
    } catch (error) {
      toast.error('加载数据失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  useEffect(() => {
    if (!expectedBorrowDate || !expectedReturnDate || expectedReturnDate < expectedBorrowDate || selectedItemIds.length === 0) {
      setAvailabilityConflicts([])
      setAvailabilityChecking(false)
      setAvailabilityCheckFailed(false)
      return
    }
    let cancelled = false
    setAvailabilityChecking(true)
    setAvailabilityCheckFailed(false)
    borrowService.checkAvailability(selectedItemIds, expectedBorrowDate, expectedReturnDate)
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
  }, [selectedItemIds, expectedBorrowDate, expectedReturnDate])

  const borrowTypeOptions = getBorrowTypeOptions(chains.map(chain => chain.borrow_type))

  const currentChain = chains.find((c) => c.borrow_type === borrowType)
    || chains.find((c) => c.borrow_type === 'all')
  const borrowTypeInfo = getBorrowTypeInfo(borrowType)

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
    setSelectedItemIds((current) => current.includes(id) ? current : [...current, id])
  }

  const removeItem = (id: string) => {
    setSelectedItemIds((current) => current.filter((itemId) => itemId !== id))
  }

  const handleSubmit = async () => {
    if (selectedItemIds.length === 0) {
      toast.error('请至少选择一台样机')
      return
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
    if (borrowType === 'customer') {
      if (!customerName.trim()) {
        toast.error('请填写客户名称')
        return
      }
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
        customer_name: borrowType === 'customer' ? customerName.trim() : undefined,
        customer_contact: borrowType === 'customer' ? customerContact.trim() : undefined,
        expected_borrow_date: expectedBorrowDate,
        expected_return_date: expectedReturnDate,
      }
      await borrowService.createRequest(input)
      // 保存客户到地址簿（异步，不阻塞跳转）
      if (borrowType === 'customer' && saveCustomer && customerName.trim()) {
        customerService.save(customerName.trim(), customerContact.trim()).catch(console.error)
      }
      toast.success('借用申请已提交')
      navigate(`/borrow/my-requests`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '提交失败')
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

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">借用申请</h1>
        <p className="text-muted-foreground mt-1">填写借用信息，提交审批流程</p>
      </div>

      {/* 样机选择 */}
      <Card>
        <CardHeader>
          <CardTitle>选择样机</CardTitle>
          <CardDescription>选择在申请日期内无冲突的样机；正常借出设备可申请未来日期，逾期设备不可预约</CardDescription>
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
              {filteredItems.filter((item) => !selectedItemIds.includes(item.id)).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">
                      {item.name} - {item.model}
                      {item.category ? ` (${item.category.name})` : ''}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {getItemSerialLabel(item)}
                    </span>
                    <Badge className={`${getItemAvailabilityClass(item)} shrink-0 text-xs`}>
                      {getItemAvailabilityLabel(item)}
                    </Badge>
                  </span>
                </SelectItem>
              ))}
              {filteredItems.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  未找到可预约样机
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
                      <Badge className={`${getItemAvailabilityClass(selectedItem)} text-xs`}>
                        {getItemAvailabilityLabel(selectedItem)}
                      </Badge>
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

          {borrowType === 'customer' && (
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="borrowDate">预计借用日期 *</Label>
              <Input
                id="borrowDate"
                type="date"
                value={expectedBorrowDate}
                onChange={(e) => setExpectedBorrowDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="returnDate">预计归还日期 *</Label>
              <Input
                id="returnDate"
                type="date"
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
              {currentChain.steps.map((step, index) => (
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
                  {index < currentChain.steps.length - 1 && (
                    <div className="ml-4 h-6 w-px bg-border" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无对应审批流程配置</p>
          )}
        </CardContent>
      </Card>

      {/* 提交按钮 */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          取消
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || availabilityChecking || availabilityCheckFailed || availabilityConflicts.length > 0}>
          {submitting && <Spinner className="mr-2 size-4" />}
          提交申请
        </Button>
      </div>
    </div>
  )
}
