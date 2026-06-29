import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { parseProjectSubRoute } from '../lib/projectRoute'

export function useProjectSubRoute() {
  const { pathname } = useLocation()
  return useMemo(() => parseProjectSubRoute(pathname), [pathname])
}
