/* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V5 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Pencil, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import { ReturnPhotoGallery } from '@/components/borrow/return-photo-gallery'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/auth-context'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { canEditBorrowRequest } from '@/lib/borrow-request'
import { getErrorMessage } from '@/lib/errors'
import { borrowService } from '@/services/borrow.service'
import type { ApprovalRecord, BorrowRequestDetail as BorrowRequestDetailData } from '@/types'

interface BorrowRequestDetailProps {
  mode: 'mine' | 'admin'
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN')
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function getApprovalStepLabel(record: ApprovalRecord) {
  if (record.step_label) return record.step_label
  const step = record.chain?.steps?.find((candidate) => candidate.level === record.step_level)
  return step?.label || `第 ${record.step_level} 级审批`
}

export function BorrowRequestDetail({ mode }: BorrowRequestDetailProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<BorrowRequestDetailData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const backPath = mode === 'admin' ? '/admin/request-history' : '/borrow/my-requests'

  const loadRequest = useCallback(async () => {
    if (!id) {
      setLoadError('申请编号缺失，无法加载详情。')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const data = await borrowService.getRequestDetail(id)
      if (!data) {
        setDetail(null)
        setLoadError('未找到申请，或当前账号没有查看权限。')
        return
      }
      if (mode === 'mine' && data.request.requester_id !== user?.id) {
        setDetail(null)
        setLoadError('该申请不属于当前账号，请从“我的申请”重新进入。')
        return
      }
      setDetail(data)
    } catch (error: unknown) {
      console.error('[BorrowRequestDetail] load error:', error)
      setDetail(null)
      setLoadError(getErrorMessage(error, '申请详情加载失败，请稍后重试。'))
      toast.error('申请详情加载失败')
    } finally {
      setLoading(false)
    }
  }, [id, mode, user?.id])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  const approvalRecords = useMemo(
    () => [...(detail?.request.approval_records || [])].sort((a, b) => a.step_level - b.step_level),
    [detail?.request.approval_records],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-label="正在加载申请详情">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!detail || loadError) {
    return (
      <div className="hm-page mx-auto max-w-3xl space-y-5">
        <Button variant="ghost" onClick={() => navigate(backPath)}>
          <ArrowLeft className="mr-2 size-4" />
          返回列表
        </Button>
        <Card>
          <CardContent className="flex min-h-48 flex-col items-start justify-center gap-3 p-6">
            <h1 className="text-xl font-semibold">无法显示申请详情</h1>
            <p className="text-sm text-muted-foreground">{loadError || '未找到申请记录。'}</p>
            <Button onClick={loadRequest}>重新加载</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { request, return_photos: returnPhotos } = detail
  const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
  const statusInfo = REQUEST_STATUS_MAP[request.status] || {
    label: request.status,
    color: 'bg-muted text-muted-foreground',
  }
  const editable = mode === 'mine' && canEditBorrowRequest(request, user?.id)
  const firstPendingStep = approvalRecords.find((record) => record.action === null)?.step_level
  const hasCompletedReturn = ['returned', 'partially_returned'].includes(request.status)
    || detail.borrow_records.some((record) => record.status === 'returned')

  return (
    <div className="hm-page mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" className="mb-3 -ml-3" onClick={() => navigate(backPath)}>
            <ArrowLeft className="mr-2 size-4" />
            {mode === 'admin' ? '返回申请历史' : '返回我的申请'}
          </Button>
          <h1 className="hm-page-title">申请详情</h1>
          <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{request.request_number}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
          {editable && (
            <Button onClick={() => navigate(`/borrow/requests/${request.id}/edit`)}>
              <Pencil className="mr-2 size-4" />
              编辑申请
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>申请信息</CardTitle>
              <CardDescription>提交内容、借用日期与样机明细</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">申请人</dt>
                  <dd className="mt-1 font-medium">{request.requester?.display_name || '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">部门</dt>
                  <dd className="mt-1 font-medium">{request.requester?.department || '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">联系电话</dt>
                  <dd className="mt-1 break-all font-medium">{request.requester?.phone || '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">邮箱</dt>
                  <dd className="mt-1 break-all font-medium">{request.requester?.email || '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {request.borrow_type === 'transfer' ? '转借申请日期' : '预计借用日期'}
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatDate(request.expected_borrow_date)}</dd>
                </div>
                {request.borrow_type === 'transfer' && request.actual_borrow_date && (
                  <div>
                    <dt className="text-muted-foreground">转借生效日期</dt>
                    <dd className="mt-1 font-medium tabular-nums">{formatDate(request.actual_borrow_date)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">预计归还日期</dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatDate(request.expected_return_date)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">申请时间</dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatDateTime(request.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">最后更新</dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatDateTime(request.updated_at)}</dd>
                </div>
              </dl>

              {request.borrow_type === 'customer' && (
                <div className="border-t pt-4 text-sm">
                  <p className="text-muted-foreground">客户信息</p>
                  <p className="mt-1 font-medium">
                    {request.customer_name || '-'}
                    {request.customer_contact ? ` · ${request.customer_contact}` : ''}
                  </p>
                </div>
              )}

              <div className="border-t pt-4 text-sm">
                <p className="text-muted-foreground">借用用途</p>
                <p className="mt-1 whitespace-pre-wrap leading-6">{request.purpose || '-'}</p>
              </div>

              <div className="border-t pt-4">
                <div className="mb-3 flex items-center gap-2">
                  <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h2 className="text-sm font-semibold">申请样机（{request.request_items?.length || 0} 台）</h2>
                </div>
                <div className="divide-y rounded-[var(--radius-card)] border">
                  {(request.request_items || []).map((line) => {
                    const sourceRecord = line.source_borrow_record
                    const ownRecord = detail.borrow_records.find((record) => record.request_item_id === line.id)
                    const successor = ownRecord?.transferred_to
                    const lineState = line.status === 'transferred'
                      ? '已转借'
                      : line.status === 'borrowed'
                        ? '借用中'
                        : line.status === 'returned'
                          ? '已归还'
                          : line.status === 'reserved'
                            ? '已预约'
                            : '处理中'

                    return (
                      <div key={line.id} className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium">{line.item?.name || line.item_id}</p>
                            <Badge variant="outline">{lineState}</Badge>
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {line.item?.model || '-'}{line.item?.barcode ? ` · ${line.item.barcode}` : ''}
                          </p>
                          {sourceRecord && (
                            <p className="mt-1 text-xs text-amber-700">
                              来源：{sourceRecord.borrower?.display_name || '原借用人'}
                              {sourceRecord.request?.request_number ? ` · ${sourceRecord.request.request_number}` : ''}
                            </p>
                          )}
                          {successor && (
                            <p className="mt-1 text-xs text-amber-700">
                              已转借给：{successor.borrower?.display_name || '新借用人'}
                              {successor.request?.request_number ? ` · ${successor.request.request_number}` : ''}
                            </p>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {line.status === 'transferred' && line.actual_return_date
                            ? `转借于 ${formatDate(line.actual_return_date)}`
                            : line.actual_return_date
                              ? `归还于 ${formatDate(line.actual_return_date)}`
                              : line.actual_borrow_date
                                ? `借出于 ${formatDate(line.actual_borrow_date)}`
                                : '尚未借出'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {request.status === 'revoked' ? (
                <div className="rounded-[var(--radius-card)] bg-orange-50 p-4 text-sm text-orange-800">
                  <p className="font-medium">撤销记录</p>
                  <p className="mt-1">
                    {request.revocation_reason || request.rejection_reason?.replace(/^【审批撤销】/, '') || '未记录原因'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-orange-700">
                    <span>撤销人：{request.revoker?.display_name || '历史记录未留存'}</span>
                    <span>撤销时间：{formatDateTime(request.revoked_at || request.updated_at)}</span>
                    {request.revoked_from_status && (
                      <span>
                        撤销前状态：{REQUEST_STATUS_MAP[request.revoked_from_status]?.label || request.revoked_from_status}
                      </span>
                    )}
                  </div>
                </div>
              ) : (request.rejection_reason || request.invalidation_reason) ? (
                <div className="rounded-[var(--radius-card)] bg-muted p-4 text-sm">
                  <p className="font-medium">
                    {request.status === 'invalidated' ? '失效原因' : '拒绝原因'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {request.rejection_reason || request.invalidation_reason}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>归还水印照片</CardTitle>
              <CardDescription>照片存储 30 天；拍摄时间、定位和记录元数据保留 1 年</CardDescription>
            </CardHeader>
            <CardContent>
              <ReturnPhotoGallery photos={returnPhotos} hasCompletedReturn={hasCompletedReturn} />
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>审批进度</CardTitle>
              <CardDescription>查看每一级审批人与处理结果</CardDescription>
            </CardHeader>
            <CardContent>
              {approvalRecords.length === 0 ? (
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <UserRound className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <p>暂无审批步骤；该类型可能无需人工审批。</p>
                </div>
              ) : (
                <ol className="space-y-5">
                  {approvalRecords.map((record, index) => {
                    const isApproved = record.action === 'approved'
                    const isRejected = record.action === 'rejected'
                    const isRevoked = record.action === 'revoked'
                    const isCancelled = record.action === 'cancelled'
                    const isCurrent = record.action === null && record.step_level === firstPendingStep
                    const badge = isApproved
                      ? { label: '已通过', className: 'bg-green-100 text-green-800' }
                      : isRejected
                        ? { label: '已拒绝', className: 'bg-red-100 text-red-800' }
                        : isRevoked
                          ? { label: '已撤销', className: 'bg-orange-100 text-orange-800' }
                          : isCancelled
                            ? { label: '已取消', className: 'bg-gray-100 text-gray-700' }
                            : isCurrent
                              ? { label: '待审批', className: 'bg-yellow-100 text-yellow-800' }
                              : { label: '等待中', className: 'bg-muted text-muted-foreground' }

                    return (
                      <li key={record.id} className="relative flex gap-3">
                        {index < approvalRecords.length - 1 && (
                          <span className="absolute left-[15px] top-8 h-[calc(100%+0.25rem)] w-px bg-border" aria-hidden="true" />
                        )}
                        <span className="relative z-[var(--z-base)] flex size-8 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-xs font-semibold">
                          {record.step_level}
                        </span>
                        <div className="min-w-0 flex-1 pb-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{getApprovalStepLabel(record)}</p>
                            <Badge className={badge.className}>{badge.label}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {record.approver?.display_name || '待配置审批人'}
                          </p>
                          {record.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{record.comment}</p>}
                          {record.acted_at && (
                            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                              {formatDateTime(record.acted_at)}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
