import { useAuth } from '../../auth/AuthContext'
import { api } from '../../api/client'
import { SecretsPanel } from '../../components/SecretsPanel'
import { PageHeader } from '../../components/ui'

export function AdminCiSecretsPage() {
  const { token } = useAuth()

  if (!token) return null

  return (
    <>
      <PageHeader
        title="Server CI/CD variables"
        subtitle={
          <>
            Instance-wide secrets and variables available to every pipeline. Group and repository
            entries with the same name and environment override these. Use{' '}
            <code className="font-mono text-xs">{'${{ secrets.NAME }}'}</code> and{' '}
            <code className="font-mono text-xs">{'${{ vars.NAME }}'}</code> in{' '}
            <code className="font-mono text-xs">.pertisk-ci.yaml</code>.
          </>
        }
      />

      <SecretsPanel
        token={token}
        title="Server CI/CD"
        description="Visible to super admins only. Merge order: predefined → server → group → repository."
        queryKey={['instance-secrets']}
        listSecrets={() => api.listInstanceSecrets(token)}
        createSecret={(payload) => api.createInstanceSecret(token, payload)}
        updateSecret={(id, payload) => api.updateInstanceSecret(token, id, payload)}
        deleteSecret={(id) => api.deleteInstanceSecret(token, id)}
      />
    </>
  )
}
