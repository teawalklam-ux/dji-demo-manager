import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signInDemo: () => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  hasRole: (role: UserRole) => boolean
  isAdmin: boolean
  isSuperAdmin: boolean
  isApprover: boolean
  isPendingApproval: boolean
  isDisabled: boolean
  isDemoMode: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemoMode, setIsDemoMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function initializeAuth() {
      if (import.meta.env.DEV) {
        const { demoApi, isDemoSessionActive, setDemoSessionActive } = await import('@/lib/demo-mode')
        if (isDemoSessionActive()) {
          setIsDemoMode(true)
          try {
            const { user: demoUser, profile: demoProfile } = await demoApi.getSession()
            if (cancelled) return
            setUser(demoUser)
            setProfile(demoProfile)
          } catch (error) {
            console.error('restore demo session error:', error)
            setDemoSessionActive(false)
            if (cancelled) return
            setIsDemoMode(false)
            setUser(null)
            setProfile(null)
          } finally {
            if (!cancelled) setLoading(false)
          }
          return
        }
      }

      // 获取当前 session
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (cancelled) return
        if (error) {
          console.error('getSession error:', error)
          setLoading(false)
          return
        }
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchProfile(session.user.id)
        } else {
          setLoading(false)
        }
      }).catch((err) => {
        if (cancelled) return
        console.error('getSession exception:', err)
        setLoading(false)
      })

      // 监听认证状态变化 (用 setTimeout 避免 Supabase 死锁)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          if (cancelled) return
          // 密码重置流程：跳转到重置密码页面
          if (event === 'PASSWORD_RECOVERY') {
            window.location.href = '/dji-demo-manager/reset-password'
            return
          }

          setUser(session?.user ?? null)
          if (session?.user) {
            setTimeout(() => fetchProfile(session.user.id), 0)
          } else {
            setProfile(null)
            setLoading(false)
          }
        }
      )
      unsubscribe = () => subscription.unsubscribe()
    }

    void initializeAuth()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('fetchProfile error:', error)
        setProfile(null)
      } else {
        setProfile(data)
      }
    } catch (err) {
      console.error('fetchProfile exception:', err)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? new Error(error.message) : null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('登录失败') }
    }
  }

  async function signInDemo() {
    if (!import.meta.env.DEV) {
      return { error: new Error('本地演示模式仅在开发环境可用') }
    }

    try {
      const {
        DEMO_EMAIL,
        DEMO_PASSWORD,
        demoApi,
        setDemoSessionActive,
      } = await import('@/lib/demo-mode')
      const { user: demoUser, profile: demoProfile } = await demoApi.login(DEMO_EMAIL, DEMO_PASSWORD)
      setDemoSessionActive(true)
      setIsDemoMode(true)
      setUser(demoUser)
      setProfile(demoProfile)
      setLoading(false)
      return { error: null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('本地演示登录失败') }
    }
  }

  async function signUp(email: string, password: string, displayName: string) {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
          },
          emailRedirectTo: `${window.location.origin}/dji-demo-manager/login`,
        },
      })
      return { error: error ? new Error(error.message) : null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('注册失败') }
    }
  }

  async function signOut() {
    if (import.meta.env.DEV && isDemoMode) {
      const { setDemoSessionActive } = await import('@/lib/demo-mode')
      setDemoSessionActive(false)
      setIsDemoMode(false)
      setUser(null)
      setProfile(null)
      return
    }

    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  function hasRole(role: UserRole): boolean {
    if (!profile) return false
    // super_admin 拥有所有权限
    if (profile.role === 'super_admin') return true
    // admin 拥有 admin/approver/user 权限
    if (profile.role === 'admin') {
      return role === 'admin' || role === 'approver' || role === 'user'
    }
    // approver 拥有 approver/user 权限
    if (profile.role === 'approver') {
      return role === 'approver' || role === 'user'
    }
    // 普通用户只能匹配 user
    return profile.role === role
  }

  const isSuperAdmin = profile?.role === 'super_admin'
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const isApprover = profile?.role === 'approver' || isAdmin
  const isPendingApproval = profile?.status === 'pending_approval'
  const isDisabled = profile?.status === 'disabled'

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signInDemo, signUp, signOut, hasRole, isAdmin, isSuperAdmin, isApprover, isPendingApproval, isDisabled, isDemoMode }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
