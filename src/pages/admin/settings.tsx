import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const STORAGE_KEY = 'dji_demo_system_settings'

interface Settings {
  barcode_prefix: string
  default_borrow_days: number
  overdue_remind_days: number
  overdue_email_notify: boolean
  overdue_wecom_notify: boolean
}

interface WeComConfigStatus {
  webhookConfigured: boolean
  approvalRecipientsConfigured: boolean
  returnRecipientsConfigured: boolean
  managedBy: 'supabase_edge_function_secrets'
}

const defaultSettings: Settings = {
  barcode_prefix: 'DJI',
  default_borrow_days: 14,
  overdue_remind_days: 1,
  overdue_email_notify: true,
  overdue_wecom_notify: false,
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Settings> & { wecom_webhook_url?: unknown }
      delete parsed.wecom_webhook_url
      const sanitized = { ...defaultSettings, ...parsed }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
      return sanitized
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
  const [wecomStatus, setWecomStatus] = useState<WeComConfigStatus | null>(null)
  const [wecomStatusLoading, setWecomStatusLoading] = useState(true)

  useEffect(() => {
    const saved = loadSettings()
    setSettings(saved)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadWeComStatus() {
      try {
        const { data, error } = await supabase.functions.invoke<WeComConfigStatus>('wecom-config-status', {
          body: {},
        })
        if (error) throw error
        if (!cancelled) setWecomStatus(data)
      } catch (error) {
        console.error('读取企业微信服务端配置状态失败:', error)
      } finally {
        if (!cancelled) setWecomStatusLoading(false)
      }
    }

    loadWeComStatus()
    return () => {
      cancelled = true
    }
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
              <div className="flex min-h-10 items-center rounded-md border bg-muted/30 px-3 text-sm">
                <span
                  className={`mr-2 size-2 rounded-full ${
                    wecomStatus?.webhookConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  aria-hidden="true"
                />
                {wecomStatusLoading
                  ? '正在检查服务端配置…'
                  : wecomStatus?.webhookConfigured
                    ? '已在服务端安全配置'
                    : '未配置或状态不可用'}
              </div>
              <p className="text-xs text-muted-foreground">
                Webhook 仅由 Supabase Edge Function Secret 管理，浏览器不会读取或保存原始地址。
              </p>
              {!wecomStatusLoading && wecomStatus?.webhookConfigured && (
                <p className="text-xs text-muted-foreground">
                  审批抄送人：{wecomStatus.approvalRecipientsConfigured ? '已配置' : '未配置'}；归还收件人：
                  {wecomStatus.returnRecipientsConfigured ? '已配置' : '未配置'}
                </p>
              )}
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
