import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { parseAdminRoute } from '../lib/adminRoute'
import { useSuperAdmin } from './useSuperAdmin'

export function useAdminNav() {
  const location = useLocation()
  const isSuperAdmin = useSuperAdmin()
  const route = useMemo(() => parseAdminRoute(location.pathname), [location.pathname])

  if (!route || !isSuperAdmin) return null

  return {
    ...route,
    isSuperAdmin,
  }
}
