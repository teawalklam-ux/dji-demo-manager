import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { BorrowRecord } from '@/types'
import { BORROW_TYPE_MAP } from '@/lib/constants'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Label } from '@/components/ui/label'

export function BorrowReturn() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const recordId = id

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [record, setRecord] = useState<BorrowRecord | null>(null)
  const [notes, setNotes] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadRecord = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    setLoadError(null)
    try {
      console.log('[return] recordId from URL:', recordId)

      // 方法1: 直接用 supabase 查询 borrow_records（最原始方式）
      console.log('[return] trying direct supabase query...')
      const { data: directData, error: directError } = await supabase
        .from('borrow_records')
        .select('*')
        .eq('request_id', recordId)
        .maybeSingle()

      console.log('[return] direct query result:', directData, 'error:', directError)

      if (directError) {
        throw new Error('直接查询失败: ' + directError.message)
      }

      if (directData) {
        setRecord(directData as BorrowRecord)
        setLoading(false)
        return
      }

      // 方法2: 按 borrow_record_id 查
      console.log('[return] trying by borrow_record_id...')
      const { data: allData, error: allError } = await supabase
        .from('borrow_records')
        .select('*')
        .order('created_at', { ascending: false })

      console.log('[return] all records count:', allData?.length, 'error:', allError)

      if (allError) {
        throw new Error('查询全部失败: ' + allError.message)
      }

      const found = allData?.find((r) => r.id === recordId || r.request_id === recordId)
      if (found) {
        setRecord(found as BorrowRecord)
      } else {
        setRecord(null)
      }
    } catch (error: any) {
      console.error('[return] error:', error)
      setLoadError(error.message || '加载失败')
      toast.error('加载借用记录失败: ' + (error.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    loadRecord()
  }, [loadRecord])

  const handleConfirmReturn = async () => {
    if (!recordId) return
    setSubmitting(true)
    try {
      await borrowService.processReturn(recordId, notes.trim() || undefined)
      toast.success('归还确认成功')
      navigate('/borrow/my-requests')
    } catch (error: any) {
      toast.error(error.message || '归还确认失败')
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
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Spinner className="size-6" />
        <p className="text-sm text-muted-foreground">正在加载借用记录...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="py-12 text-center text-red-600">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{loadError}</p>
        </div>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>返回</Button>
          <Button onClick={loadRecord}>重试</Button>
        </div>
      </div>
    )
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="py-12 text-center text-muted-foreground">
          未找到借用记录
        </div>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>返回</Button>
          <Button onClick={loadRecord}>重试</Button>
        </div>
      </div>
    )
  }

  const typeInfo = BORROW_TYPE_MAP[record.borrow_type]

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">归还样机</h1>
        <p className="text-muted-foreground mt-1">确认归还借用设备</p>
      </div>

      {/* 借用记录详情 */}
      <Card>
        <CardHeader>
          <CardTitle>借用信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">样机名称: </span>
              {record.item?.name || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">型号: </span>
              {record.item?.model || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">条码: </span>
              {record.item?.barcode || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">借用类型: </span>
              <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">借用人: </span>
              {record.borrower?.display_name || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">部门: </span>
              {record.borrower?.department || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">借用日期: </span>
              {formatDate(record.borrow_date)}
            </div>
            <div>
              <span className="text-muted-foreground">应还日期: </span>
              {formatDate(record.due_date)}
            </div>
            {record.overdue_days > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground">逾期天数: </span>
                <Badge className="bg-red-100 text-red-800">{record.overdue_days} 天</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 归还备注 */}
      <Card>
        <CardHeader>
          <CardTitle>归还备注</CardTitle>
          <CardDescription>可选填写归还时的情况说明</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="notes">备注信息</Label>
            <Textarea
              id="notes"
              placeholder="如有设备损坏或其他情况，请在此说明..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
        <Button onClick={handleConfirmReturn} disabled={submitting}>
          {submitting && <Spinner className="mr-2 size-4" />}
          确认归还
        </Button>
      </div>
    </div>
  )
}
