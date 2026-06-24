import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, RefreshCw, Server, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Runner } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { Breadcrumbs, PageHeader, PrimaryButton, SecondaryButton } from '../components/ui'

function runnerStatusVariant(status: Runner['status']) {
  if (status === 'online') return 'green' as const
  if (status === 'busy') return 'yellow' as const
  return 'gray' as const
}

function formatLastSeen(lastSeen: string | null) {
  if (!lastSeen) return 'Never'
  const date = new Date(lastSeen)
  const delta = Date.now() - date.getTime()
  if (delta < 60_000) return 'Just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return date.toLocaleString()
}

function TokenModal({
  title,
  token,
  onClose,
}: {
  title: string
  token: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Copy this token now — it will not be shown again.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text break-all">
            {token}
          </div>
          <p className="text-sm text-text-secondary">
            Set on the runner host in{' '}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">/etc/pertisk-runner/pertisk-runner.conf</code>:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-bg p-3 text-xs text-text">
{`PERTISK_RUNNER_TOKEN=${token}
PERTISK_API_URL=https://your-gits-host:8080
# Optional — omit on remote runners; workspace is fetched from the API
PERTISK_REPOS_ROOT=/var/lib/pertisk-gits/repos`}
          </pre>
          <p className="text-sm text-text-secondary">
            Then restart:{' '}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">sudo systemctl restart pertisk-runner</code>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <SecondaryButton type="button" onClick={copyToken}>
            {copied ? (
              <>
                <Check size={14} />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy token
              </>
            )}
          </SecondaryButton>
          <PrimaryButton type="button" onClick={onClose}>
            Done
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export function RunnersPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [labels, setLabels] = useState('self-hosted')
  const [error, setError] = useState<string | null>(null)
  const [tokenModal, setTokenModal] = useState<{ title: string; token: string } | null>(null)

  const { data: runners = [], isLoading } = useQuery({
    queryKey: ['runners'],
    queryFn: () => api.listRunners(token!),
    enabled: Boolean(token),
    refetchInterval: 15_000,
  })

  const registerRunner = useMutation({
    mutationFn: () =>
      api.registerRunner(token!, {
        name: name.trim(),
        labels: labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setName('')
      setLabels('self-hosted')
      setError(null)
      setTokenModal({ title: 'Runner registered', token: data.token })
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteRunner = useMutation({
    mutationFn: (runnerId: string) => api.deleteRunner(token!, runnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const rotateToken = useMutation({
    mutationFn: (runnerId: string) => api.rotateRunnerToken(token!, runnerId),
    onSuccess: (data, runnerId) => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setError(null)
      const runner = runners.find((r) => r.id === runnerId)
      setTokenModal({
        title: runner ? `New token for ${runner.name}` : 'New runner token',
        token: data.token,
      })
    },
    onError: (err: Error) => setError(err.message),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    registerRunner.mutate()
  }

  return (
    <>
      {tokenModal && (
        <TokenModal
          title={tokenModal.title}
          token={tokenModal.token}
          onClose={() => setTokenModal(null)}
        />
      )}

      <Breadcrumbs items={[{ label: 'CI Runners' }]} />
      <PageHeader
        title="CI runners"
        subtitle="Register self-hosted runners and manage authentication tokens"
      />

      <div className="space-y-5 max-w-4xl">
        <div className="gogs-panel">
          <div className="gogs-panel-header flex items-center gap-2">
            <Server size={15} className="text-primary" />
            Register runner
          </div>
          <div className="gogs-panel-body space-y-4">
            <p className="text-sm text-text-secondary">
              Create a runner, copy the token, then configure it on the host running{' '}
              <span className="font-mono text-text">pertisk-runner</span>. Labels must match{' '}
              <span className="font-mono text-text">runs-on</span> in{' '}
              <span className="font-mono text-text">.pertisk-ci.yaml</span>.
            </p>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="runner-name" className="text-sm font-medium text-text">
                    Runner name
                  </label>
                  <input
                    id="runner-name"
                    className="gogs-field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="pertisk-proxy"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="runner-labels" className="text-sm font-medium text-text">
                    Labels
                  </label>
                  <input
                    id="runner-labels"
                    className="gogs-field font-mono text-sm"
                    value={labels}
                    onChange={(e) => setLabels(e.target.value)}
                    placeholder="self-hosted, docker"
                    required
                  />
                  <p className="text-xs text-text-secondary">
                    Comma-separated. Example: <code>self-hosted</code> or{' '}
                    <code>docker, self-hosted</code>
                  </p>
                </div>
              </div>
              <PrimaryButton type="submit" disabled={registerRunner.isPending}>
                {registerRunner.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Registering…
                  </>
                ) : (
                  'Register runner'
                )}
              </PrimaryButton>
            </form>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {error}
          </div>
        )}

        <div className="gogs-panel">
          <div className="gogs-panel-header">Registered runners</div>
          <div className="gogs-panel-body">
            {isLoading ? (
              <div className="text-sm text-text-secondary">Loading runners…</div>
            ) : runners.length === 0 ? (
              <p className="text-sm text-text-secondary">No runners registered yet.</p>
            ) : (
              <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                {runners.map((runner) => (
                  <li key={runner.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text">{runner.name}</span>
                        <StatusBadge variant={runnerStatusVariant(runner.status)}>
                          {runner.status}
                        </StatusBadge>
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        Labels: {runner.labels.join(', ') || 'self-hosted'}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        Last seen {formatLastSeen(runner.last_seen_at)} · Registered{' '}
                        {new Date(runner.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => rotateToken.mutate(runner.id)}
                        disabled={rotateToken.isPending}
                        className="p-2 rounded-md border border-border text-text-secondary hover:bg-hover hover:text-primary"
                        title="Rotate token"
                        data-no-global-button-hover="true"
                      >
                        <RefreshCw size={14} className={rotateToken.isPending ? 'animate-spin' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete runner "${runner.name}"?`)) {
                            deleteRunner.mutate(runner.id)
                          }
                        }}
                        className="p-2 rounded-md border border-border text-text-secondary hover:text-dashboard-danger hover:border-red-r1/30"
                        title="Delete runner"
                        data-no-global-button-hover="true"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
