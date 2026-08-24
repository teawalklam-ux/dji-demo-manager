import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { toast } from 'sonner'
import type { BorrowRequest } from '@/types'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import type { BorrowRequestStatus } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { canEditBorrowRequest } from '@/lib/borrow-request'
import { useAuth } from '@/contexts/auth-context'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Camera, Eye, Pencil } from 'lucide-react'
import { NasArchiveSearch } from '@/components/borrow/nas-archive-search'

type TabKey = 'all' | BorrowRequestStatus

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'partially_approved', label: '审批中' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'borrowed', label: '借用中' },
  { key: 'partially_returned', label: '部分归还' },
  { key: 'partially_transferred', label: '部分转借' },
  { key: 'returned', label: '已归还' },
  { key: 'transferred', label: '已转借' },
  { key: 'overdue', label: '逾期' },
  { key: 'cancelled', label: '已取消' },
]

export function MyRequests() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<BorrowRequest[]>([])
  const [activeTab, setActiveTab] = useState<string>('all')

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const data = await borrowService.getMyRequests()
      setRequests(data)
    } catch (error) {
      toast.error('加载申请列表失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const filteredRequests =
    activeTab === 'all'
      ? requests
      : requests.filter((r) => r.status === activeTab)

  const handleCancel = async (id: string) => {
    if (!confirm('确认取消该申请？')) return
    try {
      await borrowService.cancelRequest(id)
      toast.success('申请已取消')
      loadRequests()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '取消失败'))
    }
  }

  const handleApplyReturn = (recordId: string) => {
    navigate(`/borrow/return/${recordId}`)
  }

  const handleRenewal = (requestId: string) => {
    navigate(`/borrow/renew/${requestId}`)
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">我的申请</h1>
        <p className="text-muted-foreground mt-1">查看和管理我的借用申请</p>
      </div>

      <NasArchiveSearch mode="mine" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4 space-y-4">
          {filteredRequests.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              暂无申请记录
            </div>
          ) : (
            filteredRequests.map((request) => {
              const statusInfo = REQUEST_STATUS_MAP[request.status]
              const typeInfo = BORROW_TYPE_MAP[request.borrow_type]
              const returnableItemCount = request.request_items?.filter((line) => line.status === 'borrowed').length || 0
              const canReturn = returnableItemCount > 0 || ['borrowed', 'partially_returned', 'partially_transferred', 'overdue'].includes(request.status)
              const canEdit = canEditBorrowRequest(request, user?.id)
              return (
                <Card key={request.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <CardTitle className="text-base">
                        {request.request_number}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">样机（{request.request_items?.length || 0} 台）: </span>
                        {request.request_items?.map((line) => line.item?.name || line.item_id).join('、') || '-'}
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          {request.borrow_type === 'transfer' ? '生效方式: ' : '借用日期: '}
                        </span>
                        {request.borrow_type === 'transfer' ? '最终审批通过即生效' : formatDate(request.expected_borrow_date)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">归还日期: </span>
                        {formatDate(request.expected_return_date)}
                      </div>
                      {['customer', 'transfer'].includes(request.borrow_type) && request.customer_name && (
                        <div>
                          <span className="text-muted-foreground">客户: </span>
                          {request.customer_name}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">申请时间: </span>
                        {formatDate(request.created_at)}
                      </div>
                    </div>
                    {request.purpose && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">用途: </span>
                        {request.purpose}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {request.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCancel(request.id)}
                        >
                          取消申请
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/borrow/requests/${request.id}`)}
                      >
                        <Eye className="mr-1 size-4" />
                        查看详情
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/borrow/requests/${request.id}/edit`)}
                        >
                          <Pencil className="mr-1 size-4" />
                          编辑申请
                        </Button>
                      )}
                      {canReturn && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleApplyReturn(request.id)}
                          >
                            <Camera className="mr-1 size-4" />
                            拍照归还{returnableItemCount > 1 ? `（${returnableItemCount} 台待归还）` : ''}
                          </Button>
                          {['borrowed', 'partially_transferred'].includes(request.status) && request.borrow_type !== 'transfer' && <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRenewal(request.id)}
                          >
                            申请续借
                          </Button>}
                        </>
                      )}
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
