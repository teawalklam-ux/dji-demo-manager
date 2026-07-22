import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { borrowService } from '@/services/borrow.service'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { BorrowRecord } from '@/types'
import { BORROW_TYPE_MAP } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import { ReturnPhotoCapture } from '@/components/borrow/return-photo-capture'
import type { PhotoData } from '@/components/borrow/return-photo-capture'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function BorrowReturn() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const recordId = id

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [record, setRecord] = useState<BorrowRecord | null>(null)
  const [activeRecords, setActiveRecords] = useState<BorrowRecord[]>([])
  const [notes, setNotes] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [photoData, setPhotoData] = useState<PhotoData | null>(null)

  const loadRecord = useCallback(async () => {
    if (!recordId) {
      setLoading(false)
      setLoadError('缺少借用记录ID')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      // 先按借用记录 ID 查找；路由也兼容申请单 ID，以便一单多台时选择待归还样机。
      const { data: directData, error: directError } = await supabase
        .from('borrow_records')
        .select('*, item:items(*), borrower:profiles(*)')
        .eq('id', recordId)
        .in('status', ['active', 'overdue'])
        .maybeSingle()

      if (directError) {
        throw new Error('查询失败: ' + directError.message)
      }

      if (directData) {
        setRecord(directData as BorrowRecord)
        setActiveRecords([directData as BorrowRecord])
        return
      }

      const { data: requestRecords, error: allError } = await supabase
        .from('borrow_records')
        .select('*, item:items(*), borrower:profiles(*)')
        .eq('request_id', recordId)
        .in('status', ['active', 'overdue'])
        .order('created_at', { ascending: false })

      if (allError) {
        throw new Error('查询失败: ' + allError.message)
      }

      const records = (requestRecords || []) as BorrowRecord[]
      setActiveRecords(records)
      setRecord(records[0] || null)
    } catch (error: unknown) {
      setLoadError(getErrorMessage(error, '加载失败'))
      toast.error('加载借用记录失败')
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    loadRecord()
  }, [loadRecord])

  const handleConfirmReturn = async () => {
    if (!record) return
    if (!photoData) {
      toast.error('请先拍摄归还照片')
      return
    }
    setSubmitting(true)
    try {
      // 必须传 borrow_records.id，不是 request_id
      await borrowService.processReturn(record.id, {
        notes: notes.trim() || undefined,
        photo: photoData,
      })
      toast.success('归还确认成功')
      navigate('/borrow/my-requests')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '归还确认失败'))
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
          {activeRecords.length > 1 && (
            <div className="space-y-2">
              <Label>选择要归还的样机</Label>
              <Select value={record.id} onValueChange={(id) => {
                setRecord(activeRecords.find((candidate) => candidate.id === id) || null)
                setPhotoData(null)
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {activeRecords.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.item?.name || candidate.item_id} · {candidate.item?.model || '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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

      {/* 归还拍照（必填） */}
      <ReturnPhotoCapture
        key={record.id}
        onPhotoCaptured={(data) => setPhotoData(data)}
        onPhotoCleared={() => setPhotoData(null)}
      />

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
        <Button onClick={handleConfirmReturn} disabled={submitting || !photoData}>
          {submitting && <Spinner className="mr-2 size-4" />}
          确认归还
        </Button>
      </div>
    </div>
  )
}
