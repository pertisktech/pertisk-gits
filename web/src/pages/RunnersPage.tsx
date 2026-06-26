import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Server } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Runner } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { DeleteRunnerConfirm, RotateRunnerConfirm } from '../components/ConfirmModal'
import { RunnerCard, TokenModal } from '../components/RunnerCard'
import { parseRunnerLabels } from '../lib/runnerLabels'
import { Alert, Breadcrumbs, PageHeader, PrimaryButton } from '../components/ui'
import { FieldLabel, Input } from '../components/ui/Input'

type RunnerConfirm =
  | { action: 'rotate'; runner: Runner }
  | { action: 'delete'; runner: Runner }

export function RunnersPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [labels, setLabels] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tokenModal, setTokenModal] = useState<{
    title: string
    token: string
    apiUrl: string
  } | null>(null)
  const [confirm, setConfirm] = useState<RunnerConfirm | null>(null)

  const { data: runners = [], isLoading } = useQuery({
    queryKey: ['runners'],
    queryFn: () => api.listRunners(token!),
    enabled: Boolean(token),
    refetchInterval: 5_000,
  })

  const registerRunner = useMutation({
    mutationFn: () =>
      api.registerRunner(token!, {
        name: name.trim(),
        labels: parseRunnerLabels(labels),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setName('')
      setLabels('')
      setError(null)
      setTokenModal({
        title: 'Runner registered',
        token: data.token,
        apiUrl: data.api_url,
      })
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteRunner = useMutation({
    mutationFn: (runnerId: string) => api.deleteRunner(token!, runnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setError(null)
      setConfirm(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const rotateToken = useMutation({
    mutationFn: (runnerId: string) => api.rotateRunnerToken(token!, runnerId),
    onSuccess: (data, runnerId) => {
      queryClient.invalidateQueries({ queryKey: ['runners'] })
      setError(null)
      setConfirm(null)
      const runner = runners.find((r) => r.id === runnerId)
      setTokenModal({
        title: runner ? `New token for ${runner.name}` : 'New runner token',
        token: data.token,
        apiUrl: data.api_url,
      })
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleConfirm() {
    if (!confirm) return
    if (confirm.action === 'rotate') {
      rotateToken.mutate(confirm.runner.id)
      return
    }
    deleteRunner.mutate(confirm.runner.id)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (parseRunnerLabels(labels).length === 0) {
      setError('Add at least one label (comma-separated).')
      return
    }
    registerRunner.mutate()
  }

  return (
    <>
      {tokenModal && (
        <TokenModal
          title={tokenModal.title}
          token={tokenModal.token}
          apiUrl={tokenModal.apiUrl}
          onClose={() => setTokenModal(null)}
        />
      )}

      {confirm?.action === 'rotate' && (
        <RotateRunnerConfirm
          runnerName={confirm.runner.name}
          loading={rotateToken.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.action === 'delete' && (
        <DeleteRunnerConfirm
          runnerName={confirm.runner.name}
          loading={deleteRunner.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Runners' },
        ]}
      />
      <PageHeader
        title="CI runners"
        subtitle="Register runners with labels that match runs-on in .pertisk-ci.yaml"
      />

      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,24rem)_1fr] xl:items-start">
        <div className="shell-card">
          <div className="shell-card-header flex items-center gap-2">
            <Server size={15} className="text-brand-500" />
            Register runner
          </div>
          <div className="shell-card-body space-y-4">
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              Install <span className="font-mono text-gray-800 dark:text-white/90">pertisk-runner</span> on a host, register
              it here with labels, then copy the token into{' '}
              <span className="font-mono text-gray-800 dark:text-white/90">/etc/pertisk-runner/pertisk-runner.conf</span>.
              Jobs run on runners whose labels match{' '}
              <span className="font-mono text-gray-800 dark:text-white/90">runs-on</span> in the pipeline file.
            </p>
            <form className="space-y-4" onSubmit={onSubmit}>
              <FieldLabel label="Runner name">
                <Input
                  id="runner-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="pertisk-proxy"
                  required
                />
              </FieldLabel>
              <FieldLabel
                label="Labels"
                hint="Comma-separated. A job with runs-on: docker runs only on runners that include the docker label."
              >
                <Input
                  id="runner-labels"
                  className="font-mono text-theme-sm"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                  placeholder="linux, docker, amd64"
                  required
                />
              </FieldLabel>
              <PrimaryButton type="submit" disabled={registerRunner.isPending} startIcon={registerRunner.isPending ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                {registerRunner.isPending ? 'Registering…' : 'Register runner'}
              </PrimaryButton>
            </form>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
        {error && <Alert>{error}</Alert>}

        <div className="shell-card">
          <div className="shell-card-header">Registered runners</div>
          <div className="shell-card-body">
            {isLoading ? (
              <div className="text-theme-sm text-gray-500 dark:text-gray-400">Loading runners…</div>
            ) : runners.length === 0 ? (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">No runners registered yet.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                {runners.map((runner) => (
                  <RunnerCard
                    key={runner.id}
                    runner={runner}
                    rotating={rotateToken.isPending && confirm?.runner.id === runner.id}
                    onRotate={() => setConfirm({ action: 'rotate', runner })}
                    onDelete={() => setConfirm({ action: 'delete', runner })}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
        </div>
        </div>
      </div>
    </>
  )
}
