import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { borrowService } from '@/services/borrow.service'
import { approvalService } from '@/services/approval.service'
import { toast } from 'sonner'
import type { Item, BorrowRequestInput, ApprovalChain } from '@/types'
import { BORROW_TYPE_MAP } from '@/lib/constants'
import type { BorrowType } from '@/lib/constants'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function BorrowApply() {
  const navigate = useNavigate()
  const { itemId } = useParams<{ itemId: string }>()

  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [chains, setChains] = useState<ApprovalChain[]>([])

  const [selectedItemId, setSelectedItemId] = useState(itemId || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [borrowType, setBorrowType] = useState<BorrowType>('customer')
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [purpose, setPurpose] = useState('')
  const [expectedBorrowDate, setExpectedBorrowDate] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.serial_number && item.serial_number.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const loadInitialData = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsData, chainsData] = await Promise.all([
        itemsService.getInStockItems(),
        approvalService.getChains(),
      ])
      setItems(itemsData)
      setChains(chainsData.filter((c) => c.is_active))
    } catch (error) {
      toast.error('加载数据失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  const currentChain = chains.find(
    (c) => c.borrow_type === borrowType || c.borrow_type === 'all'
  )

  const handleSubmit = async () => {
    if (!selectedItemId) {
      toast.error('请选择样机')
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
        item_id: selectedItemId,
        borrow_type: borrowType,
        purpose: purpose.trim(),
        customer_name: borrowType === 'customer' ? customerName.trim() : undefined,
        customer_contact: borrowType === 'customer' ? customerContact.trim() : undefined,
        expected_borrow_date: expectedBorrowDate,
        expected_return_date: expectedReturnDate,
      }
      await borrowService.createRequest(input)
      toast.success('借用申请已提交')
      navigate(`/borrow/my-requests`)
    } catch (error: any) {
      toast.error(error.message || '提交失败')
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
          <CardDescription>从在库样机中选择需要借用的设备</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="搜索样机名称、型号、条码或SN码..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Select value={selectedItemId} onValueChange={setSelectedItemId}>
            <SelectTrigger>
              <SelectValue placeholder="请选择样机" />
            </SelectTrigger>
            <SelectContent>
              {filteredItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} - {item.model}
                  {item.category ? ` (${item.category.name})` : ''}
                </SelectItem>
              ))}
              {filteredItems.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  未找到在库样机
                </div>
              )}
            </SelectContent>
          </Select>
          {selectedItemId && (
            <div className="rounded-md bg-muted/50 p-3">
              {(() => {
                const selectedItem = items.find((i) => i.id === selectedItemId)
                if (!selectedItem) return null
                return (
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">{selectedItem.name}</div>
                    <div className="text-muted-foreground">
                      型号: {selectedItem.model} | 条码: {selectedItem.barcode}
                      {selectedItem.location && ` | 位置: ${selectedItem.location}`}
                    </div>
                  </div>
                )
              })()}
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
            className="flex gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="customer" id="customer" />
              <Label htmlFor="customer" className="cursor-pointer">
                客户试用
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="marketing" id="marketing" />
              <Label htmlFor="marketing" className="cursor-pointer">
                营销演示
              </Label>
            </div>
          </RadioGroup>

          {borrowType === 'customer' && (
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customerName">客户名称 *</Label>
                <Input
                  id="customerName"
                  placeholder="请输入客户名称"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerContact">客户联系方式 *</Label>
                <Input
                  id="customerContact"
                  placeholder="请输入客户联系方式"
                  value={customerContact}
                  onChange={(e) => setCustomerContact(e.target.value)}
                />
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
        </CardContent>
      </Card>

      {/* 审批流程预览 */}
      <Card>
        <CardHeader>
          <CardTitle>审批流程预览</CardTitle>
          <CardDescription>
            当前类型: <Badge variant="secondary">{BORROW_TYPE_MAP[borrowType].label}</Badge>
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
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting && <Spinner className="mr-2 size-4" />}
          提交申请
        </Button>
      </div>
    </div>
  )
}
