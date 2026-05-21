import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { itemsService } from '@/services/items.service'
import { categoriesService } from '@/services/categories.service'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { ScanInput } from '@/components/barcode/scan-input'
import type { Category, ItemCreateInput } from '@/types'

export function NewItem() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<ItemCreateInput>({
    name: '',
    model: '',
    serial_number: '',
    category_id: '',
    specs: {},
    purchase_date: '',
    purchase_price: undefined,
    location: '',
    notes: '',
  })

  const [specPairs, setSpecPairs] = useState<{ key: string; value: string }[]>([])

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    try {
      const data = await categoriesService.getAll()
      setCategories(data.filter(c => c.is_active))
    } catch (error) {
      console.error('加载分类失败:', error)
    }
  }

  function handleChange(field: keyof ItemCreateInput, value: string | number | undefined) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleSpecKeyChange(index: number, key: string) {
    const updated = [...specPairs]
    updated[index] = { ...updated[index], key }
    setSpecPairs(updated)
  }

  function handleSpecValueChange(index: number, value: string) {
    const updated = [...specPairs]
    updated[index] = { ...updated[index], value }
    setSpecPairs(updated)
  }

  function addSpecPair() {
    setSpecPairs(prev => [...prev, { key: '', value: '' }])
  }

  function removeSpecPair(index: number) {
    setSpecPairs(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.name.trim()) {
      setError('请填写产品名称')
      return
    }
    if (!form.model.trim()) {
      setError('请填写产品型号')
      return
    }
    if (!form.category_id) {
      setError('请选择产品分类')
      return
    }

    try {
      setLoading(true)
      const specs: Record<string, string> = {}
      specPairs.forEach(pair => {
        if (pair.key.trim() && pair.value.trim()) {
          specs[pair.key.trim()] = pair.value.trim()
        }
      })

      const data: ItemCreateInput = {
        name: form.name.trim(),
        model: form.model.trim(),
        serial_number: form.serial_number?.trim() || undefined,
        category_id: form.category_id,
        specs: Object.keys(specs).length > 0 ? specs : undefined,
        purchase_date: form.purchase_date || undefined,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : undefined,
        location: form.location?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      }

      const item = await itemsService.create(data)
      navigate(`/items/${item.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">仅管理员可新增样机</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/items">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">新增样机</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>样机信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">产品名称 *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="请输入产品名称"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">产品型号 *</Label>
                <Input
                  id="model"
                  value={form.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="请输入产品型号"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="serial_number">序列号</Label>
                <ScanInput
                  id="serial_number"
                  value={form.serial_number || ''}
                  onChange={(val) => handleChange('serial_number', val)}
                  placeholder="请输入序列号"
                />
              </div>

              <div className="space-y-2">
                <Label>产品分类 *</Label>
                <Select value={form.category_id} onValueChange={(val) => handleChange('category_id', val)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="purchase_date">购买日期</Label>
                <Input
                  id="purchase_date"
                  type="date"
                  value={form.purchase_date || ''}
                  onChange={(e) => handleChange('purchase_date', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="purchase_price">购买价格</Label>
                <Input
                  id="purchase_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.purchase_price || ''}
                  onChange={(e) => handleChange('purchase_price', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="请输入购买价格"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="location">存放位置</Label>
                <Input
                  id="location"
                  value={form.location || ''}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder="请输入存放位置"
                />
              </div>
            </div>

            {/* 动态规格参数 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>规格参数</Label>
                <Button type="button" variant="outline" size="sm" onClick={addSpecPair}>
                  <Plus className="size-3" />
                  添加参数
                </Button>
              </div>
              {specPairs.map((pair, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder="参数名"
                    value={pair.key}
                    onChange={(e) => handleSpecKeyChange(index, e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="参数值"
                    value={pair.value}
                    onChange={(e) => handleSpecValueChange(index, e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSpecPair(index)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">备注</Label>
              <Textarea
                id="notes"
                value={form.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="请输入备注信息"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Link to="/items">
                <Button type="button" variant="outline">取消</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Spinner className="size-4" />}
                创建样机
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
