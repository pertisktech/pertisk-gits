import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CiSecret, CiSecretKind } from '../api/types'
import { Alert, PrimaryButton, SecondaryButton } from './ui'
import { FieldLabel, Input, Select, Textarea } from './ui/Input'

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

  return (
    <div className="shell-card max-w-3xl">
      <div className="shell-card-header flex items-center gap-2">
        <KeyRound size={16} />
        {title}
      </div>
      <div className="shell-card-body space-y-4">
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          Reference in pipelines as{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800">{'${{ secrets.NAME }}'}</code>.
          File secrets are written to a temp path; the reference resolves to that path.
        </p>

        {error && <Alert>{error}</Alert>}

        {isLoading ? (
          <div className="flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Loading secrets…
          </div>
        ) : secrets.length === 0 ? (
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">No secrets configured yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {secrets.map((secret) => (
              <li
                key={secret.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-theme-sm"
              >
                <div>
                  <div className="font-mono font-medium text-gray-800 dark:text-white/90">{secret.name}</div>
                  <div className="text-theme-xs capitalize text-gray-500 dark:text-gray-400">
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
                  <button
                    type="button"
                    className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                    onClick={() => {
                      if (window.confirm(`Delete secret ${secret.name}?`)) {
                        deleteMutation.mutate(secret.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    title="Delete secret"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {showForm ? (
          <form onSubmit={onCreate} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Name">
                <Input
                  id="secret-name"
                  className="font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="API_TOKEN"
                  pattern="[A-Z][A-Z0-9_]*"
                  required
                />
              </FieldLabel>
              <FieldLabel label="Type">
                <Select
                  id="secret-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CiSecretKind)}
                >
                  <option value="variable">Variable</option>
                  <option value="file">File (PEM, key material)</option>
                </Select>
              </FieldLabel>
            </div>
            <FieldLabel label="Value">
              <Textarea
                id="secret-value"
                className="font-mono text-theme-xs"
                rows={kind === 'file' ? 6 : 2}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </FieldLabel>
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
          <SecondaryButton type="button" onClick={() => setShowForm(true)} startIcon={<Plus size={14} />}>
            Add secret
          </SecondaryButton>
        )}
      </div>
    </div>
  )
}
