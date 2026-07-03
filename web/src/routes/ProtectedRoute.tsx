import { Navigate, Outlet } from 'react-router-dom'
import { getStoredAuthToken, useAuth } from '../auth/AuthContext'

export function ProtectedRoute() {
  const { token } = useAuth()
  const effectiveToken = token ?? getStoredAuthToken()
  if (!effectiveToken) return <Navigate to="/login" replace />
  return <Outlet />
}
