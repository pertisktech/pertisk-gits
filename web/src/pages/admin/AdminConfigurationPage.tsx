import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { Alert, Breadcrumbs, PageHeader } from '../../components/ui'

export function AdminConfigurationPage() {
  const { token } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-configuration'],
    queryFn: () => api.getAdminConfiguration(token!),
    enabled: Boolean(token),
  })

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Configuration' },
        ]}
      />
      <PageHeader
        title="Configuration"
        subtitle="Read-only deployment settings. Secrets are never exposed."
      />

      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading configuration…
        </div>
      )}

      {error && <Alert>{(error as Error).message}</Alert>}

      {data && (
        <div className="max-w-3xl space-y-4">
          <InfoPanel title="API">
            <InfoRow label="Host" value={<code>{data.api_host}</code>} />
            <InfoRow label="Port" value={data.api_port} />
            <InfoRow label="Public base URL" value={<code>{data.git_public_base_url}</code>} />
            <InfoRow label="Web UI dist" value={data.web_dist ? <code>{data.web_dist}</code> : '—'} />
          </InfoPanel>

          <InfoPanel title="Git">
            <InfoRow label="SSH public host" value={data.git_ssh_public_host ?? '—'} />
            <InfoRow label="SSH port" value={data.git_ssh_port ?? '—'} />
            <InfoRow label="Repositories root" value={<code>{data.repos_root}</code>} />
            <InfoRow label="Artifacts root" value={<code>{data.artifacts_root}</code>} />
          </InfoPanel>

          <InfoPanel title="Access">
            <InfoRow
              label="User registration"
              value={data.registration_enabled ? 'Enabled' : 'Disabled'}
            />
            <InfoRow
              label="Super admin env override"
              value={data.super_admin_env_override ? 'SUPER_ADMIN_USER_IDS set' : 'Not set'}
            />
            <InfoRow
              label="SSO / LDAP"
              value={
                <Link to="/admin/auth" className="text-theme-sm text-brand-500 hover:text-brand-600 dark:text-brand-400">
                  Manage auth providers
                </Link>
              }
            />
          </InfoPanel>
        </div>
      )}
    </div>
  )
}
