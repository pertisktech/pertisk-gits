import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { PersonalAccessTokensPanel } from '../components/PersonalAccessTokensPanel'
import { Breadcrumbs, PageHeader, PrimaryButton } from '../components/ui'

type ProfileForm = {
  email: string
  display_name: string
  current_password: string
  new_password: string
  confirm_password: string
}

function toProfileForm(user: { email: string; display_name: string | null }): ProfileForm {
  return {
    email: user.email,
    display_name: user.display_name ?? '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  }
}

export function ProfilePage() {
  const { token, setSession } = useAuth()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(token!),
    enabled: Boolean(token),
  })

  useEffect(() => {
    if (data?.user && !profileForm) {
      setProfileForm(toProfileForm(data.user))
    }
  }, [data?.user, profileForm])

  const { data: sshKeys = [], isLoading: keysLoading } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: () => api.listSshKeys(token!),
    enabled: Boolean(token),
  })

  const updateProfile = useMutation({
    mutationFn: () => {
      const payload: {
        email?: string
        display_name?: string
        current_password?: string
        new_password?: string
      } = {}

      if (profileForm!.email !== data?.user.email) {
        payload.email = profileForm!.email
      }
      if (profileForm!.display_name !== (data?.user.display_name ?? '')) {
        payload.display_name = profileForm!.display_name
      }
      if (profileForm!.new_password) {
        payload.current_password = profileForm!.current_password
        payload.new_password = profileForm!.new_password
      }

      return api.updateProfile(token!, payload)
    },
    onSuccess: (response) => {
      setSession(token!, response.user)
      queryClient.setQueryData(['me'], response)
      setProfileForm(toProfileForm(response.user))
      setProfileError(null)
      setProfileSuccess('Profile updated.')
    },
    onError: (err: Error) => {
      setProfileSuccess(null)
      setProfileError(err.message)
    },
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

  function onProfileSubmit(event: FormEvent) {
    event.preventDefault()
    setProfileError(null)
    setProfileSuccess(null)

    if (!profileForm || !data) return

    if (profileForm.new_password && profileForm.new_password !== profileForm.confirm_password) {
      setProfileError('New passwords do not match.')
      return
    }

    const emailChanged = profileForm.email !== data.user.email
    const displayChanged = profileForm.display_name !== (data.user.display_name ?? '')
    const passwordChanged = Boolean(profileForm.new_password)

    if (!emailChanged && !displayChanged && !passwordChanged) {
      setProfileError('No changes to save.')
      return
    }

    if (passwordChanged && !data.has_password) {
      setProfileError('Password cannot be changed for SSO-only accounts.')
      return
    }

    updateProfile.mutate()
  }

  function onSshSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createKey.mutate()
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Profile' }]} />
      <PageHeader title="User profile" subtitle="Update your account and manage SSH keys for git clone" />

      <div className="space-y-5 max-w-3xl">
        <div className="app-panel max-w-lg">
          <div className="app-panel-header">Account</div>
          <div className="app-panel-body">
            {isLoading && <div className="text-text-secondary text-sm">Loading profile…</div>}
            {profileForm && data && (
              <form className="space-y-4" onSubmit={onProfileSubmit}>
                <label className="text-sm block">
                  <span className="text-text-secondary font-medium">Username</span>
                  <input
                    className="app-field mt-1 font-mono opacity-70"
                    value={`@${data.user.username}`}
                    disabled
                  />
                </label>

                <label className="text-sm block">
                  Email
                  <input
                    className="app-field mt-1"
                    type="email"
                    value={profileForm.email}
                    onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                    required
                  />
                </label>

                <label className="text-sm block">
                  Display name
                  <input
                    className="app-field mt-1"
                    value={profileForm.display_name}
                    onChange={(e) => setProfileForm({ ...profileForm, display_name: e.target.value })}
                    placeholder="Optional"
                  />
                </label>

                <div className="text-sm">
                  <span className="text-text-secondary font-medium">Member since</span>
                  <div className="text-text mt-0.5">
                    {new Date(data.user.created_at).toLocaleDateString()}
                  </div>
                </div>

                {data.has_password ? (
                  <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-sm font-medium text-text-primary">Change password</p>
                    <label className="text-sm block">
                      Current password
                      <input
                        className="app-field mt-1"
                        type="password"
                        value={profileForm.current_password}
                        onChange={(e) =>
                          setProfileForm({ ...profileForm, current_password: e.target.value })
                        }
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="text-sm block">
                      New password
                      <input
                        className="app-field mt-1"
                        type="password"
                        value={profileForm.new_password}
                        onChange={(e) =>
                          setProfileForm({ ...profileForm, new_password: e.target.value })
                        }
                        autoComplete="new-password"
                        minLength={8}
                      />
                    </label>
                    <label className="text-sm block">
                      Confirm new password
                      <input
                        className="app-field mt-1"
                        type="password"
                        value={profileForm.confirm_password}
                        onChange={(e) =>
                          setProfileForm({ ...profileForm, confirm_password: e.target.value })
                        }
                        autoComplete="new-password"
                        minLength={8}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary border-t border-border pt-4">
                    This account uses SSO. Password changes are managed by your identity provider.
                  </p>
                )}

                {profileError && (
                  <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                    {profileError}
                  </div>
                )}
                {profileSuccess && (
                  <div className="p-3 rounded-md border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300 text-sm">
                    {profileSuccess}
                  </div>
                )}

                <PrimaryButton type="submit" disabled={updateProfile.isPending}>
                  {updateProfile.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save profile'
                  )}
                </PrimaryButton>
              </form>
            )}
          </div>
        </div>

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

            <form className="space-y-4" onSubmit={onSshSubmit}>
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
