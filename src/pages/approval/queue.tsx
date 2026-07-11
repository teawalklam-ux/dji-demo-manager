import { useState, useEffect, useCallback } from 'react'
import { approvalService } from '@/services/approval.service'
import { toast } from 'sonner'
import type { ApprovalRecord } from '@/types'
import { BORROW_TYPE_MAP } from '@/lib/constants'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

export function ApprovalQueue() {
  const [loading, setLoading] = useState(true)
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([])
  const [processedApprovals, setProcessedApprovals] = useState<ApprovalRecord[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [pending, processed] = await Promise.all([
        approvalService.getPendingApprovals(),
        approvalService.getProcessedApprovals(),
      ])
      setPendingApprovals(pending)
      setProcessedApprovals(processed)
    } catch (error) {
      toast.error('加载审批列表失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId)
    try {
      await approvalService.processApproval(requestId, 'approved')
      toast.success('审批通过')
      loadData()
    } catch (error: any) {
      toast.error(error.message || '审批操作失败')
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (requestId: string) => {
    if (!rejectReason.trim()) {
      toast.error('请填写拒绝原因')
      return
    }
    setProcessingId(requestId)
    try {
      await approvalService.processApproval(requestId, 'rejected', rejectReason.trim())
      toast.success('已拒绝申请')
      setRejectDialogOpen(null)
      setRejectReason('')
      loadData()
    } catch (error: any) {
      toast.error(error.message || '审批操作失败')
    } finally {
      setProcessingId(null)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">审批管理</h1>
        <p className="text-muted-foreground mt-1">审核借用申请</p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            待审批
            {pendingApprovals.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingApprovals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="processed">已审批</TabsTrigger>
        </TabsList>

        {/* 待审批 */}
        <TabsContent value="pending" className="mt-4 space-y-4">
          {pendingApprovals.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              暂无待审批申请
            </div>
          ) : (
            pendingApprovals.map((record) => {
              const request = record.request
              if (!request) return null
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              return (
                <Card key={record.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {request.request_number}
                      </CardTitle>
                      <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">申请人: </span>
                        {request.requester?.display_name || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">部门: </span>
                        {request.requester?.department || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">样机: </span>
                        {request.item?.name || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">型号: </span>
                        {request.item?.model || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">借用日期: </span>
                        {formatDate(request.expected_borrow_date)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">归还日期: </span>
                        {formatDate(request.expected_return_date)}
                      </div>
                    </div>
                    {request.purpose && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">用途: </span>
                        {request.purpose}
                      </div>
                    )}
                    {request.borrow_type === 'customer' && request.customer_name && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">客户: </span>
                        {request.customer_name} ({request.customer_contact || '-'})
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(request.id)}
                        disabled={processingId === request.id}
                      >
                        {processingId === request.id && <Spinner className="mr-1 size-3" />}
                        通过
                      </Button>

                      <Dialog
                        open={rejectDialogOpen === record.id}
                        onOpenChange={(open) => {
                          if (open) setRejectDialogOpen(record.id)
                          else {
                            setRejectDialogOpen(null)
                            setRejectReason('')
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={processingId === request.id}
                          >
                            拒绝
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>拒绝申请</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="rejectReason">拒绝原因 *</Label>
                              <Textarea
                                id="rejectReason"
                                placeholder="请输入拒绝原因"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setRejectDialogOpen(null)
                                  setRejectReason('')
                                }}
                              >
                                取消
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => handleReject(request.id)}
                                disabled={processingId === request.id}
                              >
                                {processingId === request.id && (
                                  <Spinner className="mr-1 size-3" />
                                )}
                                确认拒绝
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        {/* 已审批 */}
        <TabsContent value="processed" className="mt-4 space-y-4">
          {processedApprovals.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              暂无已审批记录
            </div>
          ) : (
            processedApprovals.map((record) => {
              const request = record.request
              if (!request) return null
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              const actionLabel =
                record.action === 'approved' ? '通过'
                : record.action === 'rejected' ? '拒绝'
                : '已取消'
              const actionColor =
                record.action === 'approved'
                  ? 'bg-green-100 text-green-800'
                  : record.action === 'rejected'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-600'
              return (
                <Card key={record.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {request.request_number}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        <Badge className={actionColor}>{actionLabel}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">申请人: </span>
                        {request.requester?.display_name || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">样机: </span>
                        {request.item?.name || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">借用日期: </span>
                        {formatDate(request.expected_borrow_date)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">归还日期: </span>
                        {formatDate(request.expected_return_date)}
                      </div>
                    </div>
                    {record.comment && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">审批意见: </span>
                        {record.comment}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      审批时间: {formatDateTime(record.acted_at)}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
