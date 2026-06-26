import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { Alert, Breadcrumbs, PageHeader, SecondaryButton } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'

export function AdminHealthPage() {
  const { token } = useAuth()

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.getAdminHealth(token!),
    enabled: Boolean(token),
    refetchInterval: 30_000,
  })

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Health check' },
        ]}
      />
      <PageHeader
        title="Health check"
        subtitle="Live service, database, and registry storage connectivity."
        action={
          <SecondaryButton type="button" onClick={() => refetch()} disabled={isFetching} startIcon={<RefreshCw size={16} className={isFetching ? 'animate-spin' : undefined} />}>
            Refresh
          </SecondaryButton>
        }
      />

      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Running health check…
        </div>
      )}

      {error && <Alert>{(error as Error).message}</Alert>}

      {data && (
        <div className="max-w-3xl space-y-4">
          <InfoPanel title="Status">
            <InfoRow
              label="Overall"
              value={
                <StatusBadge variant={data.status === 'ok' ? 'green' : 'red'}>
                  {data.status}
                </StatusBadge>
              }
            />
            <InfoRow label="Checked at" value={formatDateTime(data.checked_at)} />
            <InfoRow label="Version" value={<code>{data.version}</code>} />
            <InfoRow label="Public API URL" value={<code>{data.api_url}</code>} />
          </InfoPanel>

          <InfoPanel title="Database">
            <InfoRow
              label="Connection"
              value={
                <StatusBadge variant={data.database === 'ok' ? 'green' : 'red'}>
                  {data.database}
                </StatusBadge>
              }
            />
            <InfoRow label="Latency" value={`${data.database_latency_ms} ms`} />
            <InfoRow label="Server" value={<code className="text-xs">{data.database_version}</code>} />
          </InfoPanel>

          {data.s3 && (
            <InfoPanel title="S3 storage">
              <InfoRow
                label="Connection"
                value={
                  <StatusBadge variant={data.s3.status === 'ok' ? 'green' : 'red'}>
                    {data.s3.status}
                  </StatusBadge>
                }
              />
              <InfoRow label="Latency" value={`${data.s3.latency_ms} ms`} />
              <InfoRow label="Endpoint" value={<code className="text-xs">{data.s3.endpoint}</code>} />
              <InfoRow label="Bucket" value={<code>{data.s3.bucket}</code>} />
              <InfoRow label="Region" value={<code>{data.s3.region}</code>} />
              {data.s3.error && (
                <InfoRow
                  label="Error"
                  value={<span className="text-dashboard-danger text-xs">{data.s3.error}</span>}
                />
              )}
            </InfoPanel>
          )}
        </div>
      )}
    </div>
  )
}
