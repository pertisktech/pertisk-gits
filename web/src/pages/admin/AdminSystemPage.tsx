import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { Breadcrumbs, PageHeader } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'
import { formatBytes, formatPercent } from '../../lib/formatBytes'

function usageBar(used: number, total: number) {
  if (total <= 0) return null
  const pct = Math.min(100, (used / total) * 100)
  return (
    <div className="admin-usage-bar" aria-hidden>
      <div className="admin-usage-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

function pathWithBadge(path: string, exists: boolean) {
  return (
    <>
      <code>{path}</code>
      <span className="admin-info-badge">{exists ? 'exists' : 'missing'}</span>
    </>
  )
}

export function AdminSystemPage() {
  const { token } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-system'],
    queryFn: () => api.getAdminSystemInfo(token!),
    enabled: Boolean(token),
    refetchInterval: 30_000,
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
        subtitle="Server hardware, application process usage, and storage consumption."
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
            <InfoRow label="Hostname" value={data.host.hostname} />
          </InfoPanel>

          <InfoPanel title="Server hardware">
            <InfoRow
              label="CPU"
              value={
                <>
                  {data.host.cpu_cores} cores · {formatPercent(data.host.cpu_usage_percent)} used
                </>
              }
            />
            <InfoRow
              label="Memory"
              value={
                <div className="admin-usage-cell">
                  <span>
                    {formatBytes(data.host.memory_used_bytes)} / {formatBytes(data.host.memory_total_bytes)}
                    {' · '}
                    {formatPercent(
                      data.host.memory_total_bytes > 0
                        ? (data.host.memory_used_bytes / data.host.memory_total_bytes) * 100
                        : 0,
                    )}
                  </span>
                  {usageBar(data.host.memory_used_bytes, data.host.memory_total_bytes)}
                </div>
              }
            />
            <InfoRow
              label="Disk"
              value={
                <div className="admin-usage-cell">
                  <span>
                    {formatBytes(data.host.disk_used_bytes)} used · {formatBytes(data.host.disk_free_bytes)} free
                    {' · '}
                    {formatBytes(data.host.disk_total_bytes)} total
                  </span>
                  {usageBar(data.host.disk_used_bytes, data.host.disk_total_bytes)}
                </div>
              }
            />
          </InfoPanel>

          <InfoPanel title="Application process">
            <InfoRow label="PID" value={data.process.pid} />
            <InfoRow
              label="Memory"
              value={formatBytes(data.process.memory_bytes)}
            />
            <InfoRow
              label="CPU"
              value={formatPercent(data.process.cpu_usage_percent)}
            />
          </InfoPanel>

          <InfoPanel title="Counts">
            <InfoRow label="Users" value={data.counts.users} />
            <InfoRow label="Pending approvals" value={data.counts.pending_users} />
            <InfoRow label="Groups" value={data.counts.organizations} />
            <InfoRow label="Repositories" value={data.counts.repositories} />
            <InfoRow label="Pipeline runs" value={data.counts.pipeline_runs} />
            <InfoRow label="Runners" value={data.counts.runners} />
          </InfoPanel>

          <InfoPanel title="Application storage">
            <InfoRow
              label="Git repositories"
              value={
                <div className="admin-usage-cell">
                  {pathWithBadge(data.storage.repos_root, data.storage.repos_root_exists)}
                  <span>{formatBytes(data.storage.repos_disk_bytes)} on disk</span>
                </div>
              }
            />
            <InfoRow
              label="CI artifacts"
              value={
                <div className="admin-usage-cell">
                  {pathWithBadge(data.storage.artifacts_root, data.storage.artifacts_root_exists)}
                  <span>
                    {data.storage.artifacts_count} files · {formatBytes(data.storage.artifacts_db_bytes)} recorded
                    {' · '}
                    {formatBytes(data.storage.artifacts_disk_bytes)} on disk
                  </span>
                </div>
              }
            />
            <InfoRow
              label="Container registry"
              value={
                <div className="admin-usage-cell">
                  {pathWithBadge(data.storage.registry_root, data.storage.registry_root_exists)}
                  <span>
                    {data.storage.registry_blob_count} blobs · {formatBytes(data.storage.registry_db_bytes)} recorded
                    {' · '}
                    {formatBytes(data.storage.registry_disk_bytes)} on disk
                  </span>
                </div>
              }
            />
          </InfoPanel>
        </div>
      )}
    </>
  )
}
