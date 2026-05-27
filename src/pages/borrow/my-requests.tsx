import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { toast } from 'sonner'
import type { BorrowRequest } from '@/types'
import { BORROW_TYPE_MAP, REQUEST_STATUS_MAP } from '@/lib/constants'
import type { BorrowRequestStatus } from '@/lib/constants'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TabKey = 'all' | BorrowRequestStatus

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'partially_approved', label: '审批中' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'borrowed', label: '借用中' },
  { key: 'returned', label: '已归还' },
  { key: 'overdue', label: '逾期' },
]

export function MyRequests() {
  const navigate = useNavigate()
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
    } catch (error: any) {
      toast.error(error.message || '取消失败')
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
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
              return (
                <Card key={request.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {request.request_number}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
                        <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
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
                      {request.borrow_type === 'customer' && request.customer_name && (
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
                    <div className="flex items-center gap-2 pt-2">
                      {request.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCancel(request.id)}
                        >
                          取消申请
                        </Button>
                      )}
                      {(request.status === 'approved' || request.status === 'partially_approved') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApplyReturn(request.id)}
                        >
                          申请归还
                        </Button>
                      )}
                      {request.status === 'borrowed' && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleApplyReturn(request.id)}
                          >
                            申请归还
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRenewal(request.id)}
                          >
                            申请续借
                          </Button>
                        </>
                      )}
                      {request.status === 'overdue' && (
                        <Button
                          size="sm"
                          onClick={() => handleApplyReturn(request.id)}
                        >
                          申请归还
                        </Button>
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
