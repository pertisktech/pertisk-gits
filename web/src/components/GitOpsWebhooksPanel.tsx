import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Loader2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { PrimaryButton } from './ui'

interface GitOpsWebhooksPanelProps {
  token: string
  orgSlug: string
  repoSlug: string
}

export function GitOpsWebhooksPanel({ token, orgSlug, repoSlug }: GitOpsWebhooksPanelProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [provider, setProvider] = useState('argocd')
  const [error, setError] = useState<string | null>(null)

  const queryKey = ['gitops-webhooks', orgSlug, repoSlug]

  const { data: webhooks = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => api.listRepoGitOpsWebhooks(token, orgSlug, repoSlug),
    enabled: Boolean(token),
    retry: false,
  })

  const createWebhook = useMutation({
    mutationFn: () =>
      api.createRepoGitOpsWebhook(token, orgSlug, repoSlug, {
        name: name.trim(),
        url: url.trim(),
        provider,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setName('')
      setUrl('')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteWebhook = useMutation({
    mutationFn: (webhookId: string) =>
      api.deleteRepoGitOpsWebhook(token, orgSlug, repoSlug, webhookId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  if (isError) return null

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createWebhook.mutate()
  }

  return (
    <div className="app-panel max-w-2xl">
      <div className="app-panel-header flex items-center gap-2">
        <GitBranch size={16} />
        GitOps webhooks
      </div>
      <div className="app-panel-body space-y-5">
        <p className="text-sm text-text-secondary">
          Notify Argo CD, Flux, or other tools when this repository receives a push.
        </p>

        <form className="space-y-3" onSubmit={onSubmit}>
          <input className="app-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <input className="app-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://argocd.example/hook" required />
          <select className="app-field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="argocd">Argo CD</option>
            <option value="flux">Flux</option>
            <option value="generic">Generic</option>
          </select>
          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          <PrimaryButton type="submit" disabled={createWebhook.isPending}>
            {createWebhook.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Adding…
              </>
            ) : (
              'Add webhook'
            )}
          </PrimaryButton>
        </form>

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading webhooks…</p>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-text-secondary">No GitOps webhooks configured.</p>
        ) : (
          <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
            {webhooks.map((hook) => (
              <li key={hook.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">{hook.name}</div>
                  <div className="text-xs text-text-secondary break-all">{hook.url}</div>
                  <div className="text-xs text-muted mt-1 capitalize">{hook.provider}</div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteWebhook.mutate(hook.id)}
                  className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger"
                  data-no-global-button-hover="true"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
