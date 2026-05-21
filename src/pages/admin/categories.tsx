import { useState, useEffect, useCallback } from 'react'
import { categoriesService } from '@/services/categories.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import type { Category } from '@/types'
import { Plus, Pencil } from 'lucide-react'

interface CategoryForm {
  name: string
  code: string
  description: string
  icon_name: string
  sort_order: number
}

const emptyForm: CategoryForm = {
  name: '',
  code: '',
  description: '',
  icon_name: '',
  sort_order: 0,
}

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true)
      const data = await categoriesService.getAll()
      setCategories(data)
    } catch (err) {
      toast.error('获取分类列表失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(category: Category) {
    setEditingId(category.id)
    setForm({
      name: category.name,
      code: category.code,
      description: category.description || '',
      icon_name: category.icon_name || '',
      sort_order: category.sort_order,
    })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    if (!form.name || !form.code) {
      toast.error('请填写分类名称和编码')
      return
    }
    try {
      setSubmitting(true)
      if (editingId) {
        await categoriesService.update(editingId, {
          name: form.name,
          code: form.code,
          description: form.description || undefined,
          icon_name: form.icon_name || undefined,
          sort_order: form.sort_order,
        })
        toast.success('分类已更新')
      } else {
        await categoriesService.create({
          name: form.name,
          code: form.code,
          description: form.description || undefined,
          icon_name: form.icon_name || undefined,
          sort_order: form.sort_order,
        })
        toast.success('分类已创建')
      }
      setDialogOpen(false)
      fetchCategories()
    } catch (err) {
      toast.error(editingId ? '更新分类失败' : '创建分类失败')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    try {
      await categoriesService.toggleActive(id, !isActive)
      setCategories(prev => prev.map(c => (c.id === id ? { ...c, is_active: !isActive } : c)))
      toast.success(isActive ? '已禁用分类' : '已启用分类')
    } catch (err) {
      toast.error('操作失败')
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">分类管理</h1>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-2" />
          新增分类
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>分类列表</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>图标</TableHead>
                <TableHead>排序</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    暂无分类
                  </TableCell>
                </TableRow>
              ) : (
                categories.map(cat => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{cat.code}</code></TableCell>
                    <TableCell>{cat.description || '-'}</TableCell>
                    <TableCell>{cat.icon_name || '-'}</TableCell>
                    <TableCell>{cat.sort_order}</TableCell>
                    <TableCell>
                      <Badge variant={cat.is_active ? 'default' : 'secondary'}>
                        {cat.is_active ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(cat)}>
                          <Pencil className="size-3.5 mr-1" />
                          编辑
                        </Button>
                        <Button
                          variant={cat.is_active ? 'destructive' : 'default'}
                          size="sm"
                          onClick={() => handleToggleActive(cat.id, cat.is_active)}
                        >
                          {cat.is_active ? '禁用' : '启用'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑分类' : '新增分类'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">分类名称 *</label>
              <Input
                placeholder="例如：无人机"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">分类编码 *</label>
              <Input
                placeholder="例如：drone"
                value={form.code}
                onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述</label>
              <Input
                placeholder="分类描述"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">图标名称</label>
              <Input
                placeholder="例如：Plane"
                value={form.icon_name}
                onChange={e => setForm(prev => ({ ...prev, icon_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">排序</label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={e => setForm(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Spinner className="size-4 mr-2" />}
              {editingId ? '保存修改' : '创建分类'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
