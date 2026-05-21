import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { Spinner } from '@/components/ui/spinner'
import type { UserRole } from '@/types'

interface AuthGuardProps {
  children: React.ReactNode
  requireRole?: UserRole[]
}

export function AuthGuard({ children, requireRole }: AuthGuardProps) {
  const { user, profile, loading } = useAuth()
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

  if (requireRole && profile && !requireRole.includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
