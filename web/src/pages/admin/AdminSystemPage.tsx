import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { Breadcrumbs, PageHeader } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'

export function AdminSystemPage() {
  const { token } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-system'],
    queryFn: () => api.getAdminSystemInfo(token!),
    enabled: Boolean(token),
  })

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'System information' },
        ]}
      />
      <PageHeader
        title="System information"
        subtitle="Platform version, resource counts, and storage paths."
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
          <Loader2 size={16} className="animate-spin" />
          Loading system information…
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <div className="space-y-4 max-w-3xl">
          <InfoPanel title="Runtime">
            <InfoRow label="Application version" value={<code>{data.version}</code>} />
            <InfoRow label="Rust toolchain" value={<code>{data.rust_version}</code>} />
            <InfoRow label="Process started" value={formatDateTime(data.started_at)} />
          </InfoPanel>

          <InfoPanel title="Counts">
            <InfoRow label="Users" value={data.counts.users} />
            <InfoRow label="Groups" value={data.counts.organizations} />
            <InfoRow label="Repositories" value={data.counts.repositories} />
            <InfoRow label="Pipeline runs" value={data.counts.pipeline_runs} />
            <InfoRow label="Runners" value={data.counts.runners} />
          </InfoPanel>

          <InfoPanel title="Storage">
            <InfoRow
              label="Repositories root"
              value={
                <>
                  <code>{data.storage.repos_root}</code>
                  <span className="admin-info-badge">
                    {data.storage.repos_root_exists ? 'exists' : 'missing'}
                  </span>
                </>
              }
            />
            <InfoRow
              label="Artifacts root"
              value={
                <>
                  <code>{data.storage.artifacts_root}</code>
                  <span className="admin-info-badge">
                    {data.storage.artifacts_root_exists ? 'exists' : 'missing'}
                  </span>
                </>
              }
            />
          </InfoPanel>
        </div>
      )}
    </>
  )
}
