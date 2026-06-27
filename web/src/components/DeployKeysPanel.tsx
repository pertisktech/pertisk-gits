import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Checkbox, PrimaryButton, SecondaryButton } from './ui'

interface DeployKeysPanelProps {
  token: string
  orgSlug: string
  repoSlug: string
  embedded?: boolean
}

export function DeployKeysPanel({ token, orgSlug, repoSlug, embedded = false }: DeployKeysPanelProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [readOnly, setReadOnly] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const queryKey = ['deploy-keys', orgSlug, repoSlug]

  const { data: keys = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.listDeployKeys(token, orgSlug, repoSlug),
    enabled: Boolean(token),
  })

  const createKey = useMutation({
    mutationFn: () =>
      api.createDeployKey(token, orgSlug, repoSlug, {
        title: title.trim(),
        public_key: publicKey.trim(),
        read_only: readOnly,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setTitle('')
      setPublicKey('')
      setReadOnly(true)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteKey = useMutation({
    mutationFn: (keyId: string) => api.deleteDeployKey(token, orgSlug, repoSlug, keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createKey.mutate()
  }

  const body = (
    <div className="space-y-5">
      {!embedded && (
        <p className="text-sm text-text-secondary">
          SSH deploy keys grant read or write access to this repository only. Use them for CI,
          servers, or automation without a user account.
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading deploy keys…
        </div>
      ) : keys.length > 0 ? (
        <ul className="space-y-3">
          {keys.map((key) => (
            <li
              key={key.id}
              className="rounded-lg border border-border bg-surface-elevated/40 p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{key.title}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border ${
                      key.read_only
                        ? 'border-border text-text-secondary'
                        : 'border-amber-500/40 text-amber-600'
                    }`}
                  >
                    {key.read_only ? 'Read-only' : 'Read/write'}
                  </span>
                </div>
                <div className="text-xs font-mono text-text-secondary mt-1 break-all">
                  {key.fingerprint}
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  Added {new Date(key.created_at).toLocaleDateString()}
                </div>
              </div>
              <SecondaryButton
                type="button"
                className="shrink-0 px-2 py-1"
                disabled={deleteKey.isPending}
                onClick={() => {
                  if (window.confirm(`Delete deploy key "${key.title}"?`)) {
                    deleteKey.mutate(key.id)
                  }
                }}
              >
                <Trash2 size={14} />
                Remove
              </SecondaryButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary">No deploy keys yet.</p>
      )}

      <form className="space-y-4 border-t border-border pt-4" onSubmit={onSubmit}>
        <p className="text-sm font-medium text-text">Add deploy key</p>

        <div className="app-control-field">
          <label htmlFor="deploy-key-title" className="app-control-field-label">
            Title
          </label>
          <input
            id="deploy-key-title"
            className="app-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Production server"
            required
          />
        </div>

        <div className="app-control-field">
          <label htmlFor="deploy-key-public" className="app-control-field-label">
            Public key
          </label>
          <textarea
            id="deploy-key-public"
            className="app-field mono"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="ssh-ed25519 AAAA... deploy@host"
            rows={3}
            required
          />
        </div>

        <Checkbox
          id="deploy-key-read-only"
          row
          label="Read-only (clone and fetch only)"
          checked={readOnly}
          onChange={(e) => setReadOnly(e.target.checked)}
        />

        {error && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {error}
          </div>
        )}

        <PrimaryButton type="submit" disabled={createKey.isPending}>
          {createKey.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Adding…
            </>
          ) : (
            'Add deploy key'
          )}
        </PrimaryButton>
      </form>
    </div>
  )

  if (embedded) return body

  return (
    <div className="app-panel max-w-2xl">
      <div className="app-panel-header flex items-center gap-2">
        <KeyRound size={16} />
        Deploy keys
      </div>
      <div className="app-panel-body">{body}</div>
    </div>
  )
}
