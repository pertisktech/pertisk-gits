import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { parseActivityRoute } from '../lib/activityRoute'

export function useActivityNav() {
  const location = useLocation()
  const route = useMemo(() => parseActivityRoute(location.pathname), [location.pathname])

  if (!route) return null

  return route
}
