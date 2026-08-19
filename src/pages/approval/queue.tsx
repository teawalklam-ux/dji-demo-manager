import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { approvalService } from '@/services/approval.service'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import type { ApprovalRecord, ApprovalProgress } from '@/types'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'

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

type ProcessedFilter = 'all' | 'revokable' | 'revoked'

const REVOCABLE_REQUEST_STATUSES = new Set([
  'approved',
  'borrowed',
  'overdue',
  'partially_returned',
  'returned',
])

function canRevokeProcessedApproval(record: ApprovalRecord, isSuperAdmin: boolean) {
  return Boolean(
    isSuperAdmin &&
    record.action === 'approved' &&
    record.request &&
    REVOCABLE_REQUEST_STATUSES.has(record.request.status),
  )
}

function getRevokeImpact(status: string) {
  if (status === 'approved') {
    return '预约将被释放；申请、审批过程和撤销记录都会保留。'
  }
  if (status === 'returned') {
    return '样机已归还不受影响；申请、借用记录和撤销记录都会保留。'
  }
  return '样机将恢复为在库；未归还的借用记录会保留并标记为已撤销。'
}

export function ApprovalQueue() {
  const { isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([])
  const [processedApprovals, setProcessedApprovals] = useState<ApprovalRecord[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [revokeDialogOpen, setRevokeDialogOpen] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [detailDialogOpen, setDetailDialogOpen] = useState<string | null>(null)
  const [approvalProgress, setApprovalProgress] = useState<ApprovalProgress | null>(null)
  const [progressLoading, setProgressLoading] = useState(false)
  const [processedFilter, setProcessedFilter] = useState<ProcessedFilter>('all')

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
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
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
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
    } finally {
      setProcessingId(null)
    }
  }

  const handleRevoke = async (requestId: string) => {
    if (!revokeReason.trim()) {
      toast.error('请填写撤销原因')
      return
    }
    setProcessingId(requestId)
    try {
      await approvalService.revokeApproval(requestId, revokeReason.trim())
      toast.success('审批已撤销')
      setRevokeDialogOpen(null)
      setRevokeReason('')
      loadData()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '撤销操作失败'))
    } finally {
      setProcessingId(null)
    }
  }

  const openApprovalDetail = async (recordId: string, requestId: string) => {
    setDetailDialogOpen(recordId)
    setApprovalProgress(null)
    setProgressLoading(true)
    try {
      setApprovalProgress(await approvalService.getCurrentApprovalProgress(requestId))
    } catch (error: unknown) {
      setDetailDialogOpen(null)
      toast.error(getErrorMessage(error, '无权查看该审批流程详情'))
    } finally {
      setProgressLoading(false)
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

  const revokableCount = processedApprovals.filter((record) =>
    canRevokeProcessedApproval(record, isSuperAdmin),
  ).length
  const revokedCount = processedApprovals.filter(
    (record) => record.request?.status === 'revoked',
  ).length
  const visibleProcessedApprovals = processedApprovals.filter((record) => {
    if (processedFilter === 'revokable') {
      return canRevokeProcessedApproval(record, isSuperAdmin)
    }
    if (processedFilter === 'revoked') {
      return record.request?.status === 'revoked'
    }
    return true
  })
  const processedFilterOptions: Array<{
    key: ProcessedFilter
    label: string
    count: number
  }> = [
    { key: 'all', label: '全部', count: processedApprovals.length },
    ...(isSuperAdmin
      ? [{ key: 'revokable' as const, label: '可撤销', count: revokableCount }]
      : []),
    { key: 'revoked', label: '撤销记录', count: revokedCount },
  ]

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
                      <div className="col-span-2">
                        <span className="text-muted-foreground">样机（{request.request_items?.length || 0} 台）: </span>
                        {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
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
                      <Dialog
                        open={detailDialogOpen === record.id}
                        onOpenChange={(open) => {
                          if (!open) {
                            setDetailDialogOpen(null)
                            setApprovalProgress(null)
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openApprovalDetail(record.id, request.id)}
                          >
                            查看详情
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>审批流程详情</DialogTitle>
                          </DialogHeader>
                          {progressLoading ? (
                            <div className="flex justify-center py-8">
                              <Spinner className="size-5" />
                            </div>
                          ) : approvalProgress ? (
                            <div className="space-y-4 text-sm">
                              <div className="rounded-md border bg-muted/30 p-3">
                                <p className="text-muted-foreground">目前审批环节</p>
                                <p className="mt-1 font-medium">
                                  {approvalProgress.current_step.step_label || `第 ${approvalProgress.current_step.step_level} 步审批`}
                                </p>
                                <p className="mt-2 text-muted-foreground">
                                  当前审批人：<span className="text-foreground">{approvalProgress.current_step.approver_name || '-'}</span>
                                </p>
                              </div>
                              <div className="rounded-md border p-3">
                                <p className="text-muted-foreground">上一级审批意见</p>
                                {approvalProgress.previous_step ? (
                                  <div className="mt-2 space-y-1">
                                    <p>
                                      {approvalProgress.previous_step.approver_name}（{approvalProgress.previous_step.action === 'approved' ? '已同意' : '已拒绝'}）
                                    </p>
                                    <p>{approvalProgress.previous_step.comment || '未填写审批意见'}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatDateTime(approvalProgress.previous_step.acted_at)}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="mt-2">这是第一步审批，暂无上一级意见。</p>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                上一级审批意见仅向当前有审批权限的用户展示。
                              </p>
                            </div>
                          ) : null}
                        </DialogContent>
                      </Dialog>
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
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2"
            role="group"
            aria-label="已审批记录筛选"
          >
            <span className="px-2 text-xs font-medium text-muted-foreground">快速筛选</span>
            {processedFilterOptions.map((option) => (
              <Button
                key={option.key}
                type="button"
                size="sm"
                variant={processedFilter === option.key ? 'default' : 'ghost'}
                aria-pressed={processedFilter === option.key}
                onClick={() => setProcessedFilter(option.key)}
              >
                {option.label}
                <span className="ml-1.5 tabular-nums opacity-70">{option.count}</span>
              </Button>
            ))}
          </div>
          {processedApprovals.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              暂无已审批记录
            </div>
          ) : visibleProcessedApprovals.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              当前筛选下暂无记录
            </div>
          ) : (
            visibleProcessedApprovals.map((record) => {
              const request = record.request
              if (!request) return null
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              const isRevokedRequest = request.status === 'revoked'
              const actionLabel =
                isRevokedRequest ? '已撤销'
                : record.action === 'approved' ? '通过'
                : record.action === 'rejected' ? '拒绝'
                : record.action === 'revoked' ? '已撤销'
                : '已取消'
              const actionColor =
                isRevokedRequest
                  ? 'bg-orange-100 text-orange-800'
                  : record.action === 'approved'
                  ? 'bg-green-100 text-green-800'
                  : record.action === 'rejected'
                  ? 'bg-red-100 text-red-800'
                  : record.action === 'revoked'
                  ? 'bg-orange-100 text-orange-800'
                  : 'bg-gray-100 text-gray-600'
              const statusInfo = REQUEST_STATUS_MAP[request.status]
              const canRevoke = canRevokeProcessedApproval(record, isSuperAdmin)
              const revokeReason = request.revocation_reason ||
                request.rejection_reason?.replace(/^【审批撤销】/, '')
              const revokedFromStatus = request.revoked_from_status
                ? REQUEST_STATUS_MAP[request.revoked_from_status]?.label || request.revoked_from_status
                : null
              return (
                <Card key={record.id} className={isRevokedRequest ? 'border-orange-200' : undefined}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {request.request_number}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        <Badge className={actionColor}>{actionLabel}</Badge>
                        {statusInfo && (
                          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                        )}
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
                        {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
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
                    {isRevokedRequest && (
                      <div className="rounded-md bg-orange-50 p-3 text-sm text-orange-800">
                        <div>
                          <span className="font-medium">撤销原因：</span>
                          {revokeReason || '未记录'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-orange-700">
                          <span>撤销人：{request.revoker?.display_name || '历史记录未留存'}</span>
                          <span>撤销时间：{formatDateTime(request.revoked_at || request.updated_at)}</span>
                          {revokedFromStatus && <span>撤销前状态：{revokedFromStatus}</span>}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        审批时间: {formatDateTime(record.acted_at)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/approval/${request.id}`}>查看详情</Link>
                        </Button>
                        {canRevoke && (
                          <Dialog
                          open={revokeDialogOpen === record.id}
                          onOpenChange={(open) => {
                            if (open) setRevokeDialogOpen(record.id)
                            else {
                              setRevokeDialogOpen(null)
                              setRevokeReason('')
                            }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-400 text-orange-700 hover:bg-orange-50"
                              disabled={processingId === request.id}
                            >
                              撤销审批
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>撤销审批</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="rounded-md bg-orange-50 p-3 text-sm text-orange-800">
                                撤销后：{getRevokeImpact(request.status)}此操作不可逆。
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`revokeReason-${record.id}`}>撤销原因 *</Label>
                                <Textarea
                                  id={`revokeReason-${record.id}`}
                                  placeholder="请输入撤销原因"
                                  value={revokeReason}
                                  onChange={(e) => setRevokeReason(e.target.value)}
                                  rows={3}
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setRevokeDialogOpen(null)
                                    setRevokeReason('')
                                  }}
                                >
                                  取消
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => handleRevoke(request.id)}
                                  disabled={processingId === request.id}
                                >
                                  {processingId === request.id && (
                                    <Spinner className="mr-1 size-3" />
                                  )}
                                  确认撤销
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                          </Dialog>
                        )}
                      </div>
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
