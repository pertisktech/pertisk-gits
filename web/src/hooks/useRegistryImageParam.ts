import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const PROJECT_REGISTRY_IMAGE_PATH = /^\/groups\/.+?\/projects\/[^/]+\/registry\/([^/]+)\/?$/

export function useRegistryImageParam(): string | null {
  const { pathname } = useLocation()
  return useMemo(() => {
    const match = pathname.match(PROJECT_REGISTRY_IMAGE_PATH)
    return match ? decodeURIComponent(match[1]) : null
  }, [pathname])
}
