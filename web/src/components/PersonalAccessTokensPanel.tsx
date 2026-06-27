import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { PrimaryButton } from './ui'

interface PersonalAccessTokensPanelProps {
  token: string
}

export function PersonalAccessTokensPanel({ token }: PersonalAccessTokensPanelProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.listApiTokens(token),
    enabled: Boolean(token),
  })

  const createToken = useMutation({
    mutationFn: () => api.createApiToken(token, { name: name.trim() }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      setName('')
      setCreatedToken(data.plaintext)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteToken = useMutation({
    mutationFn: (tokenId: string) => api.deleteApiToken(token, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] }),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createToken.mutate()
  }

  return (
    <div className="app-panel">
      <div className="app-panel-header flex items-center gap-2">
        <KeyRound size={15} className="text-primary" />
        Personal access tokens
      </div>
      <div className="app-panel-body space-y-5">
        <p className="text-sm text-text-secondary">
          Use tokens instead of your password for API and Git over HTTPS. Copy the token when
          created — it is shown only once.
        </p>

        <form className="space-y-4" onSubmit={onSubmit}>
          <input
            className="app-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token name"
            required
          />
          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          {createdToken && (
            <div className="p-3 rounded-md border border-green-g1/30 bg-dashboard-success-bg text-sm font-mono break-all">
              {createdToken}
            </div>
          )}
          <PrimaryButton type="submit" disabled={createToken.isPending}>
            {createToken.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Creating…
              </>
            ) : (
              'Generate token'
            )}
          </PrimaryButton>
        </form>

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-text-secondary">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
            {tokens.map((entry) => (
              <li key={entry.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text">{entry.name}</div>
                  <div className="text-xs font-mono text-muted mt-1">
                    {entry.token_prefix ? `${entry.token_prefix}…` : 'pgs_…'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteToken.mutate(entry.id)}
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
