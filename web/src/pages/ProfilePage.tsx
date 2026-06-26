import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Alert, Breadcrumbs, PageHeader, PrimaryButton } from '../components/ui'
import { FieldLabel, Input, Textarea } from '../components/ui/Input'

export function ProfilePage() {
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(token!),
    enabled: Boolean(token),
  })

  const { data: sshKeys = [], isLoading: keysLoading } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: () => api.listSshKeys(token!),
    enabled: Boolean(token),
  })

  const createKey = useMutation({
    mutationFn: () => api.createSshKey(token!, { title, public_key: publicKey.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] })
      setTitle('')
      setPublicKey('')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteKey = useMutation({
    mutationFn: (keyId: string) => api.deleteSshKey(token!, keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ssh-keys'] }),
  })

  const profile = data?.user ?? user

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createKey.mutate()
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Profile' }]} />
      <PageHeader title="User profile" subtitle="Account information and SSH keys for git clone" />

      <div className="max-w-3xl space-y-5">
        <Card title="Account" className="max-w-lg">
          {isLoading && (
            <div className="text-theme-sm text-gray-500 dark:text-gray-400">Loading profile…</div>
          )}
          {profile && (
            <dl className="space-y-4 text-theme-sm">
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Username</dt>
                <dd className="mt-0.5 font-mono text-gray-800 dark:text-white/90">@{profile.username}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Email</dt>
                <dd className="mt-0.5 text-gray-800 dark:text-white/90">{profile.email}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Display name</dt>
                <dd className="mt-0.5 text-gray-800 dark:text-white/90">{profile.display_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Member since</dt>
                <dd className="mt-0.5 text-gray-800 dark:text-white/90">
                  {new Date(profile.created_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          )}
        </Card>

        <div className="shell-card max-w-2xl">
          <div className="shell-card-header flex items-center gap-2">
            <KeyRound size={15} className="text-brand-500" />
            SSH keys
          </div>
          <div className="shell-card-body space-y-5">
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              Add a public key to clone and push over SSH as{' '}
              <span className="font-mono text-gray-800 dark:text-white/90">git@your-host:org/repo.git</span>.
            </p>

            <form className="space-y-4" onSubmit={onSubmit}>
              <FieldLabel label="Title">
                <Input
                  id="ssh-key-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My laptop"
                  required
                />
              </FieldLabel>
              <FieldLabel label="Public key">
                <Textarea
                  id="ssh-public-key"
                  className="font-mono"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA... user@host"
                  required
                />
              </FieldLabel>

              {error && <Alert>{error}</Alert>}

              <PrimaryButton type="submit" disabled={createKey.isPending} startIcon={createKey.isPending ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                {createKey.isPending ? 'Adding…' : 'Add SSH key'}
              </PrimaryButton>
            </form>

            {keysLoading ? (
              <div className="text-theme-sm text-gray-500 dark:text-gray-400">Loading keys…</div>
            ) : sshKeys.length === 0 ? (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">No SSH keys yet.</p>
            ) : (
              <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                {sshKeys.map((key) => (
                  <li key={key.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{key.title}</div>
                      <div className="mt-1 break-all font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                        {key.fingerprint}
                      </div>
                      <div className="mt-1 text-theme-xs text-gray-400">
                        Added {new Date(key.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteKey.mutate(key.id)}
                      className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                      title="Delete key"
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
      </div>
    </div>
  )
}
