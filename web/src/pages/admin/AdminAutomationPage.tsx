import { Workflow } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { api } from '../../api/client'
import { SecretsPanel } from '../../components/SecretsPanel'
import { SettingsPanel } from '../../components/settings/SettingsPanel'

export function AdminAutomationPage() {
  const { token } = useAuth()

  if (!token) return null

  return (
    <div className="repo-settings">
      <header className="repo-settings-page-header">
        <h1 className="repo-settings-page-title">Automation</h1>
        <p className="repo-settings-page-desc">
          Server-wide CI secrets and variables available to every pipeline. Group and repository
          entries with the same name and environment override these.
        </p>
      </header>

      <div className="repo-settings-content">
        <p className="repo-settings-section-intro">
          Merge order: predefined → server → group → repository. Use{' '}
          <code className="font-mono text-xs">{'${{ secrets.NAME }}'}</code> and{' '}
          <code className="font-mono text-xs">{'${{ vars.NAME }}'}</code> in{' '}
          <code className="font-mono text-xs">.pertisk-ci.yaml</code>.
        </p>

        <SettingsPanel
          title="CI/CD variables"
          description="Instance-wide secrets (passwords, tokens) and variables (URLs, hostnames). Super admins only."
          icon={Workflow}
        >
          <SecretsPanel
            embedded
            token={token}
            title="Server CI/CD"
            description=""
            queryKey={['instance-secrets']}
            listSecrets={() => api.listInstanceSecrets(token)}
            createSecret={(payload) => api.createInstanceSecret(token, payload)}
            updateSecret={(id, payload) => api.updateInstanceSecret(token, id, payload)}
            deleteSecret={(id) => api.deleteInstanceSecret(token, id)}
          />
        </SettingsPanel>
      </div>
    </div>
  )
}
