import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { api } from '../api/client'
import { SecretsPanel } from '../components/SecretsPanel'

export function GroupSecretsPage() {
  const orgPath = useOrgPathParam()
  const { token } = useAuth()

  if (!token) return null

  return (
    <>
      <div className="app-repo-header mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text">Secrets</h1>
          <p className="text-sm text-text-secondary">
            Configure secrets per environment (dev / qa / uat / prd). Use the same name — e.g.{' '}
            <code className="font-mono text-xs">HARBOR_URL</code> — with a different value in each
            environment. Repository secrets override group secrets with the same name and environment.
          </p>
        </div>
      </div>

      <SecretsPanel
        token={token}
        title="Group secrets"
        description="Visible to group owners and admins. Values are never shown after creation."
        queryKey={['org-secrets', orgPath]}
        listSecrets={() => api.listOrgSecrets(token, orgPath)}
        createSecret={(payload) => api.createOrgSecret(token, orgPath, payload)}
        updateSecret={(id, payload) => api.updateOrgSecret(token, orgPath, id, payload)}
        deleteSecret={(id) => api.deleteOrgSecret(token, orgPath, id)}
      />
    </>
  )
}
