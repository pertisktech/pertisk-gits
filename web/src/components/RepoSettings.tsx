import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Repository } from '../api/types'
import { Alert, PrimaryButton } from './ui'
import { FieldLabel, Input, Select, Textarea } from './ui/Input'
import { RepoCollaborators } from './RepoCollaborators'
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
      <div className="shell-card max-w-2xl">
        <div className="shell-card-header">Repository settings</div>
        <form className="shell-card-body space-y-5" onSubmit={onSubmit}>
          <FieldLabel label="Name">
            <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </FieldLabel>

          <FieldLabel label="Description">
            <Textarea
              id="repo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Short description of this repository"
            />
          </FieldLabel>

          <FieldLabel label="Visibility">
            <Select
              id="repo-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </Select>
          </FieldLabel>

          <FieldLabel label="Default branch" hint="Used when opening the repository and for clone instructions.">
            <Select
              id="repo-default-branch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
            >
              {branchOptions.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </Select>
          </FieldLabel>

          {error && <Alert>{error}</Alert>}

          {saved && (
            <div className="rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-theme-sm text-success-600 dark:bg-success-500/10 dark:text-success-500">
              Settings saved.
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <PrimaryButton type="submit" disabled={mutation.isPending} startIcon={mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </form>
      </div>

      <RepoCollaborators token={token} orgSlug={orgSlug} repoSlug={repoSlug} />

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
