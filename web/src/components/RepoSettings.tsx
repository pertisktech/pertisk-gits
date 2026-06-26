import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Repository } from '../api/types'
import { PrimaryButton } from './ui'
import { RepoCollaborators } from './RepoCollaborators'
import { BranchProtection } from './BranchProtection'
import { SecretsPanel } from './SecretsPanel'

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

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="space-y-5">
      <div className="app-panel max-w-2xl">
      <div className="app-panel-header">Repository settings</div>
      <form className="app-panel-body space-y-5" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="repo-name" className="text-sm font-medium text-text">
            Name
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

        <div className="space-y-2">
          <label htmlFor="repo-visibility" className="text-sm font-medium text-text">
            Visibility
          </label>
          <select
            id="repo-visibility"
            className="app-field"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="repo-default-branch" className="text-sm font-medium text-text">
            Default branch
          </label>
          <select
            id="repo-default-branch"
            className="app-field"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
          >
            {branchOptions.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-secondary">
            Used when opening the repository and for clone instructions.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {error}
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-md border border-green-g1/30 bg-dashboard-success-bg text-dashboard-success text-sm">
            Settings saved.
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <PrimaryButton type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </PrimaryButton>
        </div>
      </form>
      </div>

      <RepoCollaborators token={token} orgSlug={orgSlug} repoSlug={repoSlug} />

      <BranchProtection
        token={token}
        orgSlug={orgSlug}
        repoSlug={repoSlug}
        branchOptions={branchOptions}
      />

      <SecretsPanel
        token={token}
        title="Repository secrets"
        description="Available only to pipelines in this repository. Override group secrets with the same name."
        queryKey={['repo-secrets', orgSlug, repoSlug]}
        listSecrets={() => api.listRepoSecrets(token, orgSlug, repoSlug)}
        createSecret={(payload) => api.createRepoSecret(token, orgSlug, repoSlug, payload)}
        updateSecret={(id, payload) =>
          api.updateRepoSecret(token, orgSlug, repoSlug, id, payload)
        }
        deleteSecret={(id) => api.deleteRepoSecret(token, orgSlug, repoSlug, id)}
      />
    </div>
  )
}
