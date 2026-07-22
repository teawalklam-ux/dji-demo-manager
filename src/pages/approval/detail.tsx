import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { approvalService } from '@/services/approval.service'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import type { BorrowRequest } from '@/types'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function ApprovalDetail() {
  const { requestId } = useParams<{ requestId: string }>()
  const { isSuperAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [request, setRequest] = useState<BorrowRequest | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  const loadRequest = useCallback(async () => {
    if (!requestId) return
    setLoading(true)
    try {
      const data = await borrowService.getRequestById(requestId)
      setRequest(data)
    } catch (error) {
      toast.error('加载申请详情失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  const handleApprove = async () => {
    if (!requestId) return
    setProcessing(true)
    try {
      await approvalService.processApproval(requestId, 'approved')
      toast.success('审批通过')
      loadRequest()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!requestId) return
    if (!rejectReason.trim()) {
      toast.error('请填写拒绝原因')
      return
    }
    setProcessing(true)
    try {
      await approvalService.processApproval(requestId, 'rejected', rejectReason.trim())
      toast.success('已拒绝申请')
      setRejectDialogOpen(false)
      setRejectReason('')
      loadRequest()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '审批操作失败'))
    } finally {
      setProcessing(false)
    }
  }

  const handleRevoke = async () => {
    if (!requestId) return
    if (!revokeReason.trim()) {
      toast.error('请填写撤销原因')
      return
    }
    setProcessing(true)
    try {
      await approvalService.revokeApproval(requestId, revokeReason.trim())
      toast.success('审批已撤销')
      setRevokeDialogOpen(false)
      setRevokeReason('')
      loadRequest()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '撤销操作失败'))
    } finally {
      setProcessing(false)
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

  // 判断当前审批步骤中是否有 pending 状态的记录
  const currentPendingRecord = request?.approval_records?.find(
    (r) => r.action === null
  )

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
      </div>
    )
  }

  const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
  const statusInfo = REQUEST_STATUS_MAP[request.status]

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">审批详情</h1>
        <p className="text-muted-foreground mt-1">查看借用申请详情及审批进度</p>
      </div>

      {/* 申请详情 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>申请信息</CardTitle>
            <div className="flex items-center gap-2">
              <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
              <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
            </div>
          </div>
          <CardDescription>{request.request_number}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">申请人: </span>
              {request.requester?.display_name || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">部门: </span>
              {request.requester?.department || '-'}
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">申请样机（{request.request_items?.length || 0} 台）: </span>
              {request.request_items?.map((line) => `${line.item?.name || line.item_id}（${line.item?.model || '-'}）`).join('、') || '-'}
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
          {request.borrow_type === 'customer' && request.customer_name && (
            <div className="text-sm">
              <span className="text-muted-foreground">客户: </span>
              {request.customer_name} ({request.customer_contact || '-'})
            </div>
          )}
          {request.purpose && (
            <div className="text-sm">
              <span className="text-muted-foreground">用途: </span>
              {request.purpose}
            </div>
          )}
          {request.rejection_reason && (
            <div className={`text-sm ${request.status === 'revoked' ? 'text-orange-700' : 'text-red-600'}`}>
              <span className="text-muted-foreground">
                {request.status === 'revoked' ? '撤销原因: ' : '拒绝原因: '}
              </span>
              {request.rejection_reason}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 审批时间线 */}
      <Card>
        <CardHeader>
          <CardTitle>审批进度</CardTitle>
        </CardHeader>
        <CardContent>
          {(!request.approval_records || request.approval_records.length === 0) ? (
            <p className="text-sm text-muted-foreground">暂无审批记录</p>
          ) : (
            <div className="space-y-4">
              {request.approval_records
                .sort((a, b) => a.step_level - b.step_level)
                .map((record, index) => {
                  const isPending = record.action === null
                  const isApproved = record.action === 'approved'
                  const isRejected = record.action === 'rejected'
                  const isCancelled = record.action === 'cancelled'
                  const isRevoked = record.action === 'revoked'

                  let statusBadge = null
                  if (isPending) {
                    statusBadge = (
                      <Badge className="bg-yellow-100 text-yellow-800">待审批</Badge>
                    )
                  } else if (isApproved) {
                    statusBadge = (
                      <Badge className="bg-green-100 text-green-800">已通过</Badge>
                    )
                  } else if (isRejected) {
                    statusBadge = (
                      <Badge className="bg-red-100 text-red-800">已拒绝</Badge>
                    )
                  } else if (isRevoked) {
                    statusBadge = (
                      <Badge className="bg-orange-100 text-orange-800">已撤销</Badge>
                    )
                  } else if (isCancelled) {
                    statusBadge = (
                      <Badge className="bg-gray-100 text-gray-600">已取消</Badge>
                    )
                  }

                  return (
                    <div key={record.id} className="relative flex gap-4">
                      {/* 连接线 */}
                      {index < request.approval_records!.length - 1 && (
                        <div className="absolute top-8 left-[15px] h-full w-px bg-border" />
                      )}
                      {/* 步骤圆点 */}
                      <div
                        className={`mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                          isPending
                            ? 'bg-yellow-100 text-yellow-800'
                            : isApproved
                            ? 'bg-green-100 text-green-800'
                            : isRevoked
                            ? 'bg-orange-100 text-orange-800'
                            : isCancelled
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {record.step_level}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {record.approver?.display_name || '审批人'}
                          </span>
                          {statusBadge}
                        </div>
                        {record.comment && (
                          <p className="text-sm text-muted-foreground">
                            {record.comment}
                          </p>
                        )}
                        {record.acted_at && (
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(record.acted_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 审批操作 (仅当前审批人可见) */}
      {currentPendingRecord && request.status !== 'approved' && request.status !== 'rejected' && request.status !== 'cancelled' && (
        <Card>
          <CardHeader>
            <CardTitle>审批操作</CardTitle>
            <CardDescription>请审核此借用申请</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={processing}
              >
                {processing && <Spinner className="mr-1 size-3" />}
                通过
              </Button>

              <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" disabled={processing}>
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
                          setRejectDialogOpen(false)
                          setRejectReason('')
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleReject}
                        disabled={processing}
                      >
                        {processing && <Spinner className="mr-1 size-3" />}
                        确认拒绝
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 撤销审批操作 (仅超级管理员，且状态为借用中/逾期/已归还) */}
      {isSuperAdmin && ['approved', 'borrowed', 'overdue', 'partially_returned', 'returned'].includes(request.status) && (
        <Card className="border-orange-300">
          <CardHeader>
            <CardTitle className="text-orange-700">撤销审批</CardTitle>
            <CardDescription>
              超级管理员可撤销已通过的审批
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800">
              撤销后：
              {request.status === 'returned'
                ? '该申请将标记为已撤销，样机已归还不受影响，借用记录保留。'
                : '借用记录将被删除，样机状态恢复为在库。'}
              此操作不可逆，且会通知申请人。
            </div>
            <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-orange-400 text-orange-700 hover:bg-orange-50"
                  disabled={processing}
                >
                  撤销审批
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>撤销审批</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="revokeReason">撤销原因 *</Label>
                    <Textarea
                      id="revokeReason"
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
                        setRevokeDialogOpen(false)
                        setRevokeReason('')
                      }}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleRevoke}
                      disabled={processing}
                    >
                      {processing && <Spinner className="mr-1 size-3" />}
                      确认撤销
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
