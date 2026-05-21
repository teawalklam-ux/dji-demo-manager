import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Save } from 'lucide-react'

const STORAGE_KEY = 'dji_demo_system_settings'

interface Settings {
  barcode_prefix: string
  default_borrow_days: number
  overdue_remind_days: number
  wecom_webhook_url: string
  overdue_email_notify: boolean
  overdue_wecom_notify: boolean
}

const defaultSettings: Settings = {
  barcode_prefix: 'DJI',
  default_borrow_days: 14,
  overdue_remind_days: 1,
  wecom_webhook_url: '',
  overdue_email_notify: true,
  overdue_wecom_notify: false,
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) }
    }
  } catch {
    // ignore
  }
  return { ...defaultSettings }
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const saved = loadSettings()
    setSettings(saved)
    setLoading(false)
  }, [])

  async function handleSave() {
    try {
      setSaving(true)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      // 短暂延迟模拟保存
      await new Promise(resolve => setTimeout(resolve, 300))
      toast.success('设置已保存')
    } catch (err) {
      toast.error('保存设置失败')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function updateField<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }))
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
        <h1 className="text-2xl font-bold">系统设置</h1>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Spinner className="size-4 mr-2" /> : <Save className="size-4 mr-2" />}
          保存设置
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基础设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">条码前缀</label>
              <Input
                value={settings.barcode_prefix}
                onChange={e => updateField('barcode_prefix', e.target.value)}
                placeholder="DJI"
              />
              <p className="text-xs text-muted-foreground">新生成样机的条码前缀</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">默认借用天数</label>
              <Input
                type="number"
                value={settings.default_borrow_days}
                onChange={e => updateField('default_borrow_days', parseInt(e.target.value) || 14)}
                min={1}
              />
              <p className="text-xs text-muted-foreground">创建借用申请时的默认天数</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">逾期提醒天数</label>
              <Input
                type="number"
                value={settings.overdue_remind_days}
                onChange={e => updateField('overdue_remind_days', parseInt(e.target.value) || 1)}
                min={0}
              />
              <p className="text-xs text-muted-foreground">到期前多少天开始提醒</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">企业微信 Webhook URL</label>
              <Input
                value={settings.wecom_webhook_url}
                onChange={e => updateField('wecom_webhook_url', e.target.value)}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              />
              <p className="text-xs text-muted-foreground">用于发送企业微信通知的 Webhook 地址</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>通知设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">逾期邮件通知</p>
              <p className="text-xs text-muted-foreground">样机逾期时发送邮件提醒借用人</p>
            </div>
            <Switch
              checked={settings.overdue_email_notify}
              onCheckedChange={v => updateField('overdue_email_notify', v)}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">逾期企业微信通知</p>
              <p className="text-xs text-muted-foreground">样机逾期时通过企业微信推送提醒</p>
            </div>
            <Switch
              checked={settings.overdue_wecom_notify}
              onCheckedChange={v => updateField('overdue_wecom_notify', v)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
