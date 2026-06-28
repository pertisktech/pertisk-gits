import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CiSecret, CiSecretEnvironment, CiSecretKind } from '../api/types'
import { PrimaryButton, SecondaryButton } from './ui'

const SECRET_ENV_ORDER: CiSecretEnvironment[] = ['dev', 'qa', 'uat', 'prd', 'all']

const SECRET_ENV_LABELS: Record<CiSecretEnvironment, string> = {
  dev: 'dev',
  qa: 'qa',
  uat: 'uat',
  prd: 'prd',
  all: 'all environments',
}

function groupSecretsByEnvironment(secrets: CiSecret[]) {
  const buckets = new Map<CiSecretEnvironment, CiSecret[]>()
  for (const env of SECRET_ENV_ORDER) {
    buckets.set(env, [])
  }
  for (const secret of secrets) {
    buckets.get(secret.environment)?.push(secret)
  }
  return SECRET_ENV_ORDER.map((environment) => ({
    environment,
    secrets: buckets.get(environment) ?? [],
  })).filter((group) => group.secrets.length > 0)
}

interface SecretsPanelProps {
  token: string
  title: string
  description: string
  queryKey: string[]
  listSecrets: () => Promise<CiSecret[]>
  createSecret: (payload: {
    name: string
    secret_kind: CiSecretKind
    environment?: CiSecretEnvironment
    value: string
  }) => Promise<CiSecret>
  updateSecret: (
    id: string,
    payload: { secret_kind?: CiSecretKind; value?: string },
  ) => Promise<CiSecret>
  deleteSecret: (id: string) => Promise<void>
  embedded?: boolean
}

export function SecretsPanel({
  token,
  title,
  description,
  queryKey,
  listSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  embedded = false,
}: SecretsPanelProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CiSecretKind>('variable')
  const [environment, setEnvironment] = useState<CiSecretEnvironment>('dev')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: secrets = [], isLoading } = useQuery({
    queryKey,
    queryFn: listSecrets,
    enabled: Boolean(token),
  })

  const createMutation = useMutation({
    mutationFn: createSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      setShowForm(false)
      setName('')
      setValue('')
      setKind('variable')
      setEnvironment('dev')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSecret,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err: Error) => setError(err.message),
  })

  const rotateMutation = useMutation({
    mutationFn: ({ id, newValue }: { id: string; newValue: string }) =>
      updateSecret(id, { value: newValue }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err: Error) => setError(err.message),
  })

  function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    createMutation.mutate({
      name: name.trim().toUpperCase(),
      secret_kind: kind,
      environment,
      value,
    })
  }

  async function onRotate(secret: CiSecret) {
    const newValue = window.prompt(`Enter new value for ${secret.name}`)
    if (!newValue) return
    rotateMutation.mutate({ id: secret.id, newValue })
  }

  const body = (
    <div className="space-y-4">
        {!embedded && description && (
          <p className="text-sm text-text-secondary">{description}</p>
        )}
        <p className="text-xs text-text-secondary">
          Use the same name in each environment with different values — for example{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5">HARBOR_URL</code> for dev and qa.
          Reference in pipelines as{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5">{'${{ secrets.HARBOR_URL }}'}</code>.
          Jobs only receive secrets for their deploy environment (set{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5">environment:</code> on the job).
        </p>

        <pre className="text-xs font-mono bg-naturals-n2 border border-naturals-n4 rounded-md p-3 text-text-secondary overflow-x-auto">
{`dev   HARBOR_URL = harbor-dev.tools.example.com
qa    HARBOR_URL = harbor-qa.tools.example.com
uat   HARBOR_URL = harbor-uat.tools.example.com
prd   HARBOR_URL = harbor.tools.example.com`}
        </pre>

        {error && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin" />
            Loading secrets…
          </div>
        ) : secrets.length === 0 ? (
          <p className="text-sm text-text-secondary">No secrets configured yet.</p>
        ) : (
          <div className="space-y-4">
            {groupSecretsByEnvironment(secrets).map((group) => (
              <section key={group.environment} className="rounded-md border border-border overflow-hidden">
                <div className="px-4 py-2 bg-naturals-n3 border-b border-border text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {SECRET_ENV_LABELS[group.environment]}
                </div>
                <ul className="divide-y divide-border">
                  {group.secrets.map((secret) => (
                    <li
                      key={secret.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <div>
                        <div className="font-mono font-medium text-text">{secret.name}</div>
                        <div className="text-xs text-text-secondary capitalize">
                          {secret.secret_kind} · updated {new Date(secret.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <SecondaryButton
                          type="button"
                          onClick={() => onRotate(secret)}
                          disabled={rotateMutation.isPending}
                        >
                          Update value
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${secret.name} (${group.environment})?`,
                              )
                            ) {
                              deleteMutation.mutate(secret.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 size={14} />
                        </SecondaryButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {showForm ? (
          <form onSubmit={onCreate} className="space-y-3 rounded-md border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-text" htmlFor="secret-name">
                  Name
                </label>
                <input
                  id="secret-name"
                  className="app-field font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="HARBOR_URL"
                  pattern="[A-Z][A-Z0-9_]*"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-text" htmlFor="secret-kind">
                  Type
                </label>
                <select
                  id="secret-kind"
                  className="app-field"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CiSecretKind)}
                >
                  <option value="variable">Variable</option>
                  <option value="file">File (PEM, key material)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-text" htmlFor="secret-environment">
                  Environment
                </label>
                <select
                  id="secret-environment"
                  className="app-field"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as CiSecretEnvironment)}
                >
                  <option value="all">All environments</option>
                  <option value="dev">dev</option>
                  <option value="qa">qa</option>
                  <option value="uat">uat</option>
                  <option value="prd">prd</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-text" htmlFor="secret-value">
                Value
              </label>
              <textarea
                id="secret-value"
                className="app-field font-mono text-xs"
                rows={kind === 'file' ? 6 : 2}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <PrimaryButton type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Add secret'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setShowForm(false)}>
                Cancel
              </SecondaryButton>
            </div>
          </form>
        ) : (
          <SecondaryButton type="button" onClick={() => setShowForm(true)}>
            <Plus size={14} />
            Add secret
          </SecondaryButton>
        )}
    </div>
  )

  if (embedded) return body

  return (
    <div className="app-panel max-w-3xl">
      <div className="app-panel-header flex items-center gap-2">
        <KeyRound size={16} />
        {title}
      </div>
      <div className="app-panel-body">{body}</div>
    </div>
  )
}
