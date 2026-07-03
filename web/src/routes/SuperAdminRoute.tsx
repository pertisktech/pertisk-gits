import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { getStoredAuthToken, useAuth } from '../auth/AuthContext'

export function SuperAdminRoute() {
  const { token, user } = useAuth()
  const effectiveToken = token ?? getStoredAuthToken()

  const { data, isLoading, isFetched } = useQuery({
    queryKey: ['me', effectiveToken],
    queryFn: () => api.me(effectiveToken!),
    enabled: Boolean(effectiveToken),
    retry: false,
  })

  if (!effectiveToken) return <Navigate to="/login" replace />

  if (isLoading || !isFetched) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Checking permissions…
      </div>
    )
  }

  const isSuperAdmin = data?.is_super_admin ?? user?.is_super_admin
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
