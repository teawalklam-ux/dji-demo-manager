import { useState, useEffect, useCallback } from 'react'
import { customerService } from '@/services/customer.service'
import { toast } from 'sonner'
import type { UserCustomer } from '@/types'
import { ROLE_MAP } from '@/lib/constants'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Trash2 } from 'lucide-react'

export function CustomersPage() {
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<UserCustomer[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await customerService.getAll()
      setCustomers(data)
    } catch (error) {
      toast.error('加载客户列表失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await customerService.delete(id)
      toast.success('已删除')
      loadData()
    } catch (error: any) {
      toast.error(error.message || '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  const filtered = customers.filter((c) => {
    const q = searchQuery.toLowerCase()
    return (
      c.customer_name.toLowerCase().includes(q) ||
      (c.customer_contact && c.customer_contact.toLowerCase().includes(q)) ||
      (c.user?.display_name && c.user.display_name.toLowerCase().includes(q)) ||
      (c.user?.department && c.user.department.toLowerCase().includes(q))
    )
  })

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
        <h1 className="text-2xl font-bold">客户地址簿</h1>
        <p className="text-muted-foreground mt-1">查看所有用户保存的客户信息（共 {customers.length} 条）</p>
      </div>

      <Input
        placeholder="搜索客户名称、联系方式、用户名或部门..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {searchQuery ? '未找到匹配的客户' : '暂无客户记录'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.customer_name}</span>
                    {c.customer_contact && (
                      <span className="text-sm text-muted-foreground">{c.customer_contact}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>来源用户: {c.user?.display_name || '-'}</span>
                    {c.user?.department && <span>| {c.user.department}</span>}
                    {c.user?.role && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {ROLE_MAP[c.user.role]?.label}
                      </Badge>
                    )}
                    <span>| 添加于 {formatDate(c.created_at)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {deletingId === c.id ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
