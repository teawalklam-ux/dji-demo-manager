import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { FieldError } from '@/components/ui/field-error'
import { clearFieldError, focusFirstFieldError, type FieldErrorMap } from '@/lib/field-errors'
import { MonitorCog } from 'lucide-react'

type AuthField = 'displayName' | 'email' | 'password'

export function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap<AuthField>>({})
  const { signIn, signInDemo, signUp } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const validationErrors: FieldErrorMap<AuthField> = {}
    if (!email.trim()) validationErrors.email = '请输入邮箱'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) validationErrors.email = '请输入有效的邮箱地址'
    if (!password) validationErrors['password'] = '请输入密码'
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      focusFirstFieldError(validationErrors)
      return
    }
    setFieldErrors({})
    setLoading(true)

    const { error } = await signIn(email, password)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? '邮箱或密码错误'
          : error.message === 'Email not confirmed'
          ? '邮箱未验证，请查收注册邮件中的验证链接'
          : error.message
      )
    } else {
      navigate('/')
    }
    setLoading(false)
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const validationErrors: FieldErrorMap<AuthField> = {}
    if (!displayName.trim()) validationErrors.displayName = '请输入姓名'
    if (!email.trim()) validationErrors.email = '请输入邮箱'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) validationErrors.email = '请输入有效的邮箱地址'
    if (password.length < 6) validationErrors['password'] = '密码至少 6 位'
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      focusFirstFieldError(validationErrors)
      return
    }
    setFieldErrors({})

    setLoading(true)
    const { error } = await signUp(email, password, displayName.trim())
    if (error) {
      setError(
        error.message.includes('already registered')
          ? '该邮箱已注册'
          : error.message
      )
    } else {
      setRegisterSuccess(true)
    }
    setLoading(false)
  }

  const handleDemoLogin = async () => {
    setError('')
    setFieldErrors({})
    setLoading(true)
    const { error } = await signInDemo()
    if (error) {
      setError(error.message)
    } else {
      navigate('/')
    }
    setLoading(false)
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
    setRegisterSuccess(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <svg aria-hidden="true" className="h-8 w-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <CardTitle className="text-2xl">设备借用管理系统</CardTitle>
          <CardDescription>
            {mode === 'login' ? '请登录以继续' : '注册新账号'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registerSuccess ? (
            <div className="space-y-4 text-center">
              <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
                注册成功！我们已向您的邮箱发送了验证邮件。<br />
                请点击邮件中的链接完成邮箱验证，然后等待管理员审批后即可登录。
              </div>
              <Button variant="outline" className="w-full" onClick={() => {
                setMode('login')
                setRegisterSuccess(false)
                setPassword('')
              }}>
                返回登录
              </Button>
            </div>
          ) : (
            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4" noValidate>
              {mode === 'register' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">姓名 *</label>
                  <Input
                    id="displayName"
                    placeholder="请输入姓名"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value)
                      clearFieldError(setFieldErrors, 'displayName')
                    }}
                    aria-invalid={Boolean(fieldErrors.displayName)}
                    aria-describedby={fieldErrors.displayName ? 'displayName-error' : undefined}
                  />
                  <FieldError field="displayName" message={fieldErrors.displayName} />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">邮箱</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="请输入邮箱"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    clearFieldError(setFieldErrors, 'email')
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                />
                <FieldError field="email" message={fieldErrors.email} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">密码</label>
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'register' ? '至少6位密码' : '请输入密码'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearFieldError(setFieldErrors, 'password')
                  }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                <FieldError field="password" message={fieldErrors.password} />
              </div>
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {mode === 'login' ? '登录' : '注册'}
              </Button>
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm">
                {mode === 'login' ? (
                  <>
                    <span>还没有账号？</span>
                    <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={switchMode}>
                      注册
                    </button>
                    {import.meta.env.DEV && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-primary"
                        disabled={loading}
                        onClick={handleDemoLogin}
                      >
                        <MonitorCog className="size-3.5" />
                        本地演示
                      </Button>
                    )}
                  </>
                ) : (
                  <>已有账号？<button type="button" className="text-primary hover:underline" onClick={switchMode}>登录</button></>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
