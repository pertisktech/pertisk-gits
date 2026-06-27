import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CiSecret, CiSecretKind } from '../api/types'
import { PrimaryButton, SecondaryButton } from './ui'

interface SecretsPanelProps {
  token: string
  title: string
  description: string
  queryKey: string[]
  listSecrets: () => Promise<CiSecret[]>
  createSecret: (payload: {
    name: string
    secret_kind: CiSecretKind
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
          Reference in pipelines as{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5">{'${{ secrets.NAME }}'}</code>.
          File secrets are written to a temp path; the reference resolves to that path.
        </p>

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
          <ul className="divide-y divide-border rounded-md border border-border">
            {secrets.map((secret) => (
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
                      if (window.confirm(`Delete secret ${secret.name}?`)) {
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
                  placeholder="API_TOKEN"
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
