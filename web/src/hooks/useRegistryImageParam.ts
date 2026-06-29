import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { parseRegistryImageRoute } from '../lib/groupRoute'

export function useRegistryImageParam(): string | null {
  const { pathname } = useLocation()
  return useMemo(() => parseRegistryImageRoute(pathname)?.imageName ?? null, [pathname])
}
