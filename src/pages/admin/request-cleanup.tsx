import { useCallback, useEffect, useMemo, useState } from 'react'
import { borrowService } from '@/services/borrow.service'
import type { DeletableBorrowRequest } from '@/services/borrow.service'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { TEST_BORROW_TYPE } from '@/lib/borrow-request-cleanup'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type CleanupTab = 'all' | 'test' | 'cancelled'

export function RequestCleanupPage() {
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [requests, setRequests] = useState<DeletableBorrowRequest[]>([])
  const [activeTab, setActiveTab] = useState<CleanupTab>('all')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      setRequests(await borrowService.getDeletableRequests())
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '加载可清理记录失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  const filteredRequests = useMemo(() => {
    if (activeTab === 'test') return requests.filter((request) => request.borrow_type === TEST_BORROW_TYPE)
    if (activeTab === 'cancelled') return requests.filter((request) => request.status === 'cancelled')
    return requests
  }, [activeTab, requests])

  const handleDelete = async (request: DeletableBorrowRequest) => {
    setDeletingId(request.id)
    try {
      const result = await borrowService.deleteEligibleRequest(request.id)
      setRequests((current) => current.filter((item) => item.id !== request.id))
      toast.success(
        `已删除 ${result.request_number}：${result.deleted_approval_count} 条审批、${result.deleted_borrow_record_count} 条借用记录`
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '删除记录失败'))
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (value: string | null) => {
    if (!value) return '-'
    return new Date(value).toLocaleString('zh-CN')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">记录清理</h1>
        <p className="mt-1 text-muted-foreground">
          仅可永久删除借用类型为“测试”，或由用户自行取消的申请及其关联审批记录。
        </p>
      </div>

      <Card className="border-orange-200 bg-orange-50/50">
        <CardContent className="pt-6 text-sm text-orange-900">
          删除操作不可恢复。关联的审批、借用、通知和库存变动记录会一并清理；若测试记录仍占用样机，系统会安全恢复其在库状态。
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CleanupTab)}>
        <TabsList>
          <TabsTrigger value="all">全部 ({requests.length})</TabsTrigger>
          <TabsTrigger value="test">
            测试类型 ({requests.filter((request) => request.borrow_type === TEST_BORROW_TYPE).length})
          </TabsTrigger>
          <TabsTrigger value="cancelled">
            用户已取消 ({requests.filter((request) => request.status === 'cancelled').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner className="size-6" /></div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">暂无可清理记录</div>
          ) : (
            filteredRequests.map((request) => {
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              const statusInfo = REQUEST_STATUS_MAP[request.status]
              const approvalCount = request.approval_records?.length || 0
              const borrowRecordCount = request.borrow_records?.length || 0

              return (
                <Card key={request.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <CardTitle className="text-base">{request.request_number}</CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        {statusInfo && <Badge className={statusInfo.color}>{statusInfo.label}</Badge>}
                        {request.borrow_type === TEST_BORROW_TYPE && <Badge variant="outline">测试数据</Badge>}
                        {request.status === 'cancelled' && <Badge variant="outline">用户已取消</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">申请人：</span>
                        {request.requester?.display_name || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">申请时间：</span>
                        {formatDate(request.created_at)}
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">样机：</span>
                        {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">审批记录：</span>{approvalCount} 条
                      </div>
                      <div>
                        <span className="text-muted-foreground">借用记录：</span>{borrowRecordCount} 条
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={deletingId === request.id}>
                            {deletingId === request.id
                              ? <Spinner className="mr-2 size-4" />
                              : <Trash2 className="mr-2 size-4" />}
                            永久删除
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认永久删除 {request.request_number}？</AlertDialogTitle>
                            <AlertDialogDescription>
                              系统将删除该申请及其 {approvalCount} 条审批记录、{borrowRecordCount} 条借用记录和其他关联数据。此操作不可撤销。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => void handleDelete(request)}
                            >
                              确认删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
