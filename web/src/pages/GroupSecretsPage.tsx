import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { api } from '../api/client'
import { SecretsPanel } from '../components/SecretsPanel'
import { PageHeader } from '../components/ui'

export function GroupSecretsPage() {
  const orgPath = useOrgPathParam()
  const { token } = useAuth()

  if (!token) return null

  return (
    <>
      <PageHeader
        title="Secrets"
        subtitle={
          <>
            Encrypted variables for CI/CD pipelines. Use the same name per environment (e.g.{' '}
            <code className="font-mono text-xs">HARBOR_REGISTRY</code>) with different values.
            Repository secrets override group secrets when names and environments match.
          </>
        }
      />

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
