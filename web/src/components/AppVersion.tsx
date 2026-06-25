import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { builtAppVersion, fetchAppVersion } from '../lib/version'
import { cn } from '../utils/cn'

export function AppVersion({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  const { data: version } = useQuery({
    queryKey: ['app-version'],
    queryFn: fetchAppVersion,
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

  const label = version ?? builtAppVersion

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={collapsed ? `Pertisk Gits v${label}` : undefined}
    >
      <GitBranch size={12} className="text-primary shrink-0" />
      <span className="app-version-label">Pertisk Gits v{label}</span>
    </span>
  )
}
