import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { OrgMember } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { formatDateTime } from '../lib/collaboration'
import { PrimaryButton, Select } from '../components/ui'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function GroupMachineUsersPage() {
  const orgPath = useOrgPathParam()
  const { token } = useAuth()
  const queryClient = useQueryClient()

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tokenName, setTokenName] = useState('')
  const [role, setRole] = useState<OrgMember['role']>('member')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queryKey = ['machine-users', orgPath]

  const { data: machineUsers = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.listMachineUsers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const createUser = useMutation({
    mutationFn: () =>
      api.createMachineUser(token!, orgPath, {
        username: username.trim(),
        display_name: displayName.trim() || undefined,
        token_name: tokenName.trim(),
        role,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey })
      setUsername('')
      setDisplayName('')
      setTokenName('')
      setRole('member')
      setCreatedToken(data.token.plaintext)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setCreatedToken(null)
    createUser.mutate()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold text-text flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          Machine users
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Service accounts for automation, CI, and integrations. Each machine user gets an API token
          scoped to this group — copy the token when created; it is shown only once.
        </p>
      </div>

      <div className="app-panel">
        <div className="app-panel-header">Create machine user</div>
        <form className="app-panel-body space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-secondary">Username</span>
              <input
                className={fieldClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="deploy-bot"
                required
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-secondary">Display name</span>
              <input
                className={fieldClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Deploy bot"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-secondary">Token name</span>
              <input
                className={fieldClass}
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="production-deploy"
                required
              />
            </label>
            <Select
              id="machine-user-role"
              label="Group role"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgMember['role'])}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </Select>
          </div>

          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}

          {createdToken && (
            <div className="p-3 rounded-md border border-green-g1/30 bg-dashboard-success-bg text-sm">
              <p className="font-medium text-text mb-2">Token created — copy now:</p>
              <code className="font-mono text-xs break-all">{createdToken}</code>
            </div>
          )}

          <PrimaryButton type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Creating…
              </>
            ) : (
              'Create machine user'
            )}
          </PrimaryButton>
        </form>
      </div>

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>Machine users</span>
          <span className="font-normal text-text-secondary">{machineUsers.length}</span>
        </div>
        <div className="app-panel-body">
          {isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : machineUsers.length === 0 ? (
            <p className="text-sm text-text-secondary">No machine users yet.</p>
          ) : (
            <ul className="divide-y divide-naturals-n4">
              {machineUsers.map((entry) => (
                <li key={entry.user.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text">
                        {entry.user.display_name ?? entry.user.username}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-text-secondary">
                        {entry.role}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5 font-mono">
                      @{entry.user.username}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Created {formatDateTime(entry.user.created_at)}
                      {entry.token_count > 0 && (
                        <>
                          {' · '}
                          {entry.token_count} token{entry.token_count === 1 ? '' : 's'}
                          {entry.latest_token_prefix ? ` (${entry.latest_token_prefix}…)` : ''}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
