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
        title="CI/CD variables"
        subtitle={
          <>
            Secrets hide passwords and tokens after save. Variables keep URLs and hostnames visible
            (e.g. SonarQube dashboard links). Use{' '}
            <code className="font-mono text-xs">{'${{ secrets.NAME }}'}</code> and{' '}
            <code className="font-mono text-xs">{'${{ vars.NAME }}'}</code> in{' '}
            <code className="font-mono text-xs">.pertisk-ci.yaml</code>.
          </>
        }
      />

      <SecretsPanel
        token={token}
        title="Group CI/CD"
        description="Visible to group owners and admins. Repository entries override group entries with the same key and environment."
        queryKey={['org-secrets', orgPath]}
        listSecrets={() => api.listOrgSecrets(token, orgPath)}
        createSecret={(payload) => api.createOrgSecret(token, orgPath, payload)}
        updateSecret={(id, payload) => api.updateOrgSecret(token, orgPath, id, payload)}
        deleteSecret={(id) => api.deleteOrgSecret(token, orgPath, id)}
      />
    </>
  )
}
