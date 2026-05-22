import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Spinner } from '@/components/ui/spinner'
import type { UserRole } from '@/types'

interface AuthGuardProps {
  children: React.ReactNode
  requireRole?: UserRole[]
}

export function AuthGuard({ children, requireRole }: AuthGuardProps) {
  const { user, profile, loading, isPendingApproval, isDisabled } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // 待审批用户 → 跳转到等待审批页面
  if (isPendingApproval && !location.pathname.startsWith('/pending-approval')) {
    return <Navigate to="/pending-approval" replace />
  }

  // 已禁用用户 → 跳转到账户禁用页面
  if (isDisabled && !location.pathname.startsWith('/account-disabled')) {
    return <Navigate to="/account-disabled" replace />
  }

  // 角色检查：admin 自动通过所有角色限制
  if (requireRole && profile && !requireRole.includes(profile.role) && profile.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
