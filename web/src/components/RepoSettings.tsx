import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Loader2, Lock } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Repository } from '../api/types'
import { parseRepoSettingsSection } from '../lib/repoSettingsRoute'
import { BranchProtection } from './BranchProtection'
import { DeployKeysPanel } from './DeployKeysPanel'
import { GitOpsWebhooksPanel } from './GitOpsWebhooksPanel'
import { RepoCollaborators } from './RepoCollaborators'
import { RepoDangerZone } from './RepoDangerZone'
import { RepoTeamAccess } from './RepoTeamAccess'
import { REPO_SETTINGS_SECTION_META, RepoSettingsNav } from './settings/RepoSettingsNav'
import { SettingsPanel } from './settings/SettingsPanel'
import { SecretsPanel } from './SecretsPanel'
import { PrimaryButton, Select } from './ui'

interface RepoSettingsProps {
  token: string
  orgSlug: string
  repoSlug: string
  project: Repository
  branches: string[]
}

export function RepoSettings({
  token,
  orgSlug,
  repoSlug,
  project,
  branches,
}: RepoSettingsProps) {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const section = parseRepoSettingsSection(searchParams.get('section'))
  const basePath = `/groups/${orgSlug}/projects/${repoSlug}`

  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [visibility, setVisibility] = useState<'public' | 'private'>(project.visibility)
  const [defaultBranch, setDefaultBranch] = useState(project.default_branch)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(project.name)
    setDescription(project.description ?? '')
    setVisibility(project.visibility)
    setDefaultBranch(project.default_branch)
  }, [project])

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(token),
  })

  const branchOptions = browserData?.browser.branches.length
    ? browserData.browser.branches
    : branches.length
      ? branches
      : [project.default_branch]

  const mutation = useMutation({
    mutationFn: () =>
      api.updateRepository(token, orgSlug, repoSlug, {
        name,
        description: description.trim() ? description : '',
        visibility,
        default_branch: defaultBranch,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['repository', orgSlug, repoSlug], data)
      queryClient.invalidateQueries({ queryKey: ['repositories', orgSlug] })
      queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] })
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
    onError: (err: Error) => {
      setError(err.message)
      setSaved(false)
    },
  })

  function onSubmitGeneral(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate()
  }

  const meta = REPO_SETTINGS_SECTION_META[section]

  return (
    <div className="repo-settings">
      <header className="repo-settings-page-header">
        <h1 className="repo-settings-page-title">Repository settings</h1>
        <p className="repo-settings-page-desc">
          Manage configuration, access, security, and automation for this repository.
        </p>
      </header>

      <RepoSettingsNav basePath={basePath} />

      <div className="repo-settings-content">
        <p className="repo-settings-section-intro">{meta.description}</p>

        {section === 'general' && (
          <SettingsPanel
            title="Repository details"
            description="Basic information shown in the repository list and clone instructions."
            icon={meta.icon}
            footer={
              <>
                {saved && (
                  <span className="text-sm text-dashboard-success">Settings saved.</span>
                )}
                <PrimaryButton type="submit" form="repo-general-form" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save changes'
                  )}
                </PrimaryButton>
              </>
            }
          >
            <form id="repo-general-form" className="space-y-5" onSubmit={onSubmitGeneral}>
              <div className="space-y-2">
                <label htmlFor="repo-name" className="text-sm font-medium text-text">
                  Repository name
                </label>
                <input
                  id="repo-name"
                  className="app-field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="repo-description" className="text-sm font-medium text-text">
                  Description
                </label>
                <textarea
                  id="repo-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="app-field"
                  placeholder="Short description of this repository"
                />
              </div>

              <div className="repo-settings-field-row">
                <Select
                  id="repo-visibility"
                  label="Visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </Select>

                <Select
                  id="repo-default-branch"
                  label="Default branch"
                  hint="Used when opening the repository."
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                >
                  {branchOptions.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-wrap gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                    visibility === 'public'
                      ? 'border-green-g1/30 text-dashboard-success bg-dashboard-success-bg'
                      : 'border-naturals-n4 text-text-secondary'
                  }`}
                >
                  {visibility === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                  {visibility === 'public' ? 'Public repository' : 'Private repository'}
                </span>
                <span className="inline-flex items-center text-xs px-2.5 py-1 rounded-full border border-naturals-n4 text-text-secondary font-mono">
                  {orgSlug}/{repoSlug}
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {error}
                </div>
              )}
            </form>
          </SettingsPanel>
        )}

        {section === 'general' && (
          <RepoDangerZone token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
        )}

        {section === 'access' && (
          <>
            <SettingsPanel
              title="Direct collaborators"
              description="Grant repository access to specific users outside the normal group permissions."
            >
              <RepoCollaborators embedded token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
            </SettingsPanel>

            <SettingsPanel
              title="Team access"
              description="Teams that grant access to this repository through group team templates."
            >
              <RepoTeamAccess embedded token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
            </SettingsPanel>
          </>
        )}

        {section === 'security' && (
          <>
            <SettingsPanel
              title="Branch protection"
              description="Require reviews, CI checks, or block force-push on matching branches."
            >
              <BranchProtection
                embedded
                token={token}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                branchOptions={branchOptions}
              />
            </SettingsPanel>

            <SettingsPanel
              title="Deploy keys"
              description="SSH keys for automation, servers, and CI — scoped to this repository only."
            >
              <DeployKeysPanel embedded token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
            </SettingsPanel>
          </>
        )}

        {section === 'automation' && (
          <>
            <SettingsPanel
              title="CI/CD variables"
              description="Secrets and variables for this repository. Repository entries override group entries with the same key and environment."
            >
              <SecretsPanel
                embedded
                token={token}
                title="Repository secrets"
                description=""
                queryKey={['repo-secrets', orgSlug, repoSlug]}
                listSecrets={() => api.listRepoSecrets(token, orgSlug, repoSlug)}
                createSecret={(payload) => api.createRepoSecret(token, orgSlug, repoSlug, payload)}
                updateSecret={(id, payload) =>
                  api.updateRepoSecret(token, orgSlug, repoSlug, id, payload)
                }
                deleteSecret={(id) => api.deleteRepoSecret(token, orgSlug, repoSlug, id)}
              />
            </SettingsPanel>

            <SettingsPanel
              title="GitOps webhooks"
              description="Notify Argo CD, Flux, or other tools when this repository receives a push."
            >
              <GitOpsWebhooksPanel embedded token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
            </SettingsPanel>
          </>
        )}
      </div>
    </div>
  )
}
