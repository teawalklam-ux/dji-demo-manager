import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

export function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? '邮箱或密码错误'
        : error.message)
    } else {
      navigate('/')
    }
    setLoading(false)
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!displayName.trim()) {
      setError('请输入姓名')
      return
    }
    if (password.length < 6) {
      setError('密码至少6位')
      return
    }

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

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
    setRegisterSuccess(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <svg className="h-8 w-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <CardTitle className="text-2xl">DJI 样机管理系统</CardTitle>
          <CardDescription>
            {mode === 'login' ? '请登录以继续' : '注册新账号'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registerSuccess ? (
            <div className="space-y-4 text-center">
              <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
                注册成功！请等待管理员审批后即可登录使用。
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
            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">姓名 *</label>
                  <Input
                    placeholder="请输入姓名"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">邮箱</label>
                <Input
                  type="email"
                  placeholder="请输入邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">密码</label>
                <Input
                  type="password"
                  placeholder={mode === 'register' ? '至少6位密码' : '请输入密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'register' ? 6 : undefined}
                />
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
              <div className="text-center text-sm">
                {mode === 'login' ? (
                  <>还没有账号？<button type="button" className="text-primary hover:underline" onClick={switchMode}>注册</button></>
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
