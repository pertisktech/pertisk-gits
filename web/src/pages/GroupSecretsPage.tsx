import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/client'
import { SecretsPanel } from '../components/SecretsPanel'

export function GroupSecretsPage() {
  const { slug = '' } = useParams()
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
        queryKey={['org-secrets', slug]}
        listSecrets={() => api.listOrgSecrets(token, slug)}
        createSecret={(payload) => api.createOrgSecret(token, slug, payload)}
        updateSecret={(id, payload) => api.updateOrgSecret(token, slug, id, payload)}
        deleteSecret={(id) => api.deleteOrgSecret(token, slug, id)}
      />
    </>
  )
}
