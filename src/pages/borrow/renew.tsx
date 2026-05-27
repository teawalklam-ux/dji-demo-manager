import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { toast } from 'sonner'
import type { BorrowRequest } from '@/types'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Label } from '@/components/ui/label'

export function BorrowRenew() {
  const navigate = useNavigate()
  const { requestId } = useParams<{ requestId: string }>()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [request, setRequest] = useState<BorrowRequest | null>(null)
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [purpose, setPurpose] = useState('')

  const loadRequest = useCallback(async () => {
    if (!requestId) return
    setLoading(true)
    try {
      console.log('[renew] requestId from URL:', requestId)
      const data = await borrowService.getRequestById(requestId)
      console.log('[renew] getRequestById result:', data)
      setRequest(data)
      // 预填新归还日期为原归还日期后14天
      if (data?.expected_return_date) {
        const current = new Date(data.expected_return_date)
        current.setDate(current.getDate() + 14)
        setExpectedReturnDate(current.toISOString().split('T')[0])
      }
    } catch (error) {
      toast.error('加载申请信息失败')
      console.error('[renew] error:', error)
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  const handleRenew = async () => {
    if (!requestId) return
    if (!expectedReturnDate) {
      toast.error('请选择新的预计归还日期')
      return
    }
    if (request && expectedReturnDate <= request.expected_return_date) {
      toast.error('新归还日期必须晚于当前归还日期')
      return
    }

    setSubmitting(true)
    try {
      await borrowService.createRenewal(requestId, {
        expected_return_date: expectedReturnDate,
        purpose: purpose.trim() || undefined,
      })
      toast.success('续借申请已提交')
      navigate('/borrow/my-requests')
    } catch (error: any) {
      toast.error(error.message || '提交续借失败')
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="py-12 text-center text-muted-foreground">
          未找到申请记录
        </div>
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            返回
          </Button>
        </div>
      </div>
    )
  }

  const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
  const statusInfo = REQUEST_STATUS_MAP[request.status]

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">申请续借</h1>
        <p className="text-muted-foreground mt-1">延长借用时间，提交续借审批</p>
      </div>

      {/* 当前借用信息 */}
      <Card>
        <CardHeader>
          <CardTitle>当前借用信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">申请编号: </span>
              {request.request_number}
            </div>
            <div>
              <span className="text-muted-foreground">状态: </span>
              <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">样机名称: </span>
              {request.item?.name || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">型号: </span>
              {request.item?.model || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">借用类型: </span>
              <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">条码: </span>
              {request.item?.barcode || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">借用日期: </span>
              {formatDate(request.expected_borrow_date)}
            </div>
            <div>
              <span className="text-muted-foreground">当前归还日期: </span>
              <span className="font-medium text-orange-600">
                {formatDate(request.expected_return_date)}
              </span>
            </div>
            {request.borrow_type === 'customer' && request.customer_name && (
              <div>
                <span className="text-muted-foreground">客户: </span>
                {request.customer_name}
              </div>
            )}
          </div>
          {request.purpose && (
            <div className="text-sm">
              <span className="text-muted-foreground">原用途: </span>
              {request.purpose}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 续借信息 */}
      <Card>
        <CardHeader>
          <CardTitle>续借信息</CardTitle>
          <CardDescription>设置新的预计归还日期</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newReturnDate">新的预计归还日期 *</Label>
            <Input
              id="newReturnDate"
              type="date"
              value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)}
              min={request.expected_return_date}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renewPurpose">续借原因</Label>
            <Textarea
              id="renewPurpose"
              placeholder="请说明续借原因（选填）"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          取消
        </Button>
        <Button onClick={handleRenew} disabled={submitting}>
          {submitting && <Spinner className="mr-2 size-4" />}
          提交续借
        </Button>
      </div>
    </div>
  )
}
