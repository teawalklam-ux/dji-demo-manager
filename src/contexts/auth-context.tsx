import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  hasRole: (role: UserRole) => boolean
  isAdmin: boolean
  isApprover: boolean
  isPendingApproval: boolean
  isDisabled: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 获取当前 session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
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
      console.error('getSession exception:', err)
      setLoading(false)
    })

    // 监听认证状态变化 (用 setTimeout 避免 Supabase 死锁)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
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

    return () => subscription.unsubscribe()
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

  async function signUp(email: string, password: string, displayName: string) {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
          },
        },
      })
      return { error: error ? new Error(error.message) : null }
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('注册失败') }
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  function hasRole(role: UserRole): boolean {
    return profile?.role === role || profile?.role === 'admin'
  }

  const isAdmin = profile?.role === 'admin'
  const isApprover = profile?.role === 'approver' || profile?.role === 'admin'
  const isPendingApproval = profile?.status === 'pending_approval'
  const isDisabled = profile?.status === 'disabled'

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, hasRole, isAdmin, isApprover, isPendingApproval, isDisabled }}>
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
