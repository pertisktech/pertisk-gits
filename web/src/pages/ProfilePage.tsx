import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { PersonalAccessTokensPanel } from '../components/PersonalAccessTokensPanel'
import { Breadcrumbs, PageHeader, PrimaryButton } from '../components/ui'

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
    <>
      <Breadcrumbs items={[{ label: 'Profile' }]} />
      <PageHeader title="User profile" subtitle="Account information and SSH keys for git clone" />

      <div className="space-y-5 max-w-3xl">
        <Card className="max-w-lg">
          {isLoading && <div className="text-text-secondary">Loading profile…</div>}
          {profile && (
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-text-secondary font-medium">Username</dt>
                <dd className="text-text mt-0.5 font-mono">@{profile.username}</dd>
              </div>
              <div>
                <dt className="text-text-secondary font-medium">Email</dt>
                <dd className="text-text mt-0.5">{profile.email}</dd>
              </div>
              <div>
                <dt className="text-text-secondary font-medium">Display name</dt>
                <dd className="text-text mt-0.5">{profile.display_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-text-secondary font-medium">Member since</dt>
                <dd className="text-text mt-0.5">{new Date(profile.created_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          )}
        </Card>

        <div className="app-panel">
          <div className="app-panel-header flex items-center gap-2">
            <KeyRound size={15} className="text-primary" />
            SSH keys
          </div>
          <div className="app-panel-body space-y-5">
            <p className="text-sm text-text-secondary">
              Add a public key to clone and push over SSH as{' '}
              <span className="font-mono text-text">git@your-host:org/repo.git</span>.
            </p>

            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label htmlFor="ssh-key-title" className="text-sm font-medium text-text">
                  Title
                </label>
                <input
                  id="ssh-key-title"
                  className="app-field"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My laptop"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="ssh-public-key" className="text-sm font-medium text-text">
                  Public key
                </label>
                <textarea
                  id="ssh-public-key"
                  className="app-field mono"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA... user@host"
                  required
                />
              </div>

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
                  'Add SSH key'
                )}
              </PrimaryButton>
            </form>

            {keysLoading ? (
              <div className="text-sm text-text-secondary">Loading keys…</div>
            ) : sshKeys.length === 0 ? (
              <p className="text-sm text-text-secondary">No SSH keys yet.</p>
            ) : (
              <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
                {sshKeys.map((key) => (
                  <li key={key.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text">{key.title}</div>
                      <div className="text-xs font-mono text-text-secondary mt-1 break-all">
                        {key.fingerprint}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        Added {new Date(key.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteKey.mutate(key.id)}
                      className="shrink-0 p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger hover:border-red-r1/30"
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

        <PersonalAccessTokensPanel token={token!} />
      </div>
    </>
  )
}
