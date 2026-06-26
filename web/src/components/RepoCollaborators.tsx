import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { RepoCollaborator, User } from '../api/types'
import { UserPicker } from './UserPicker'
import { PrimaryButton, SecondaryButton, Select } from './ui'

type RepoRole = RepoCollaborator['role']

interface RepoCollaboratorsProps {
  token: string
  orgSlug: string
  repoSlug: string
}

export function RepoCollaborators({ token, orgSlug, repoSlug }: RepoCollaboratorsProps) {
  const queryClient = useQueryClient()
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<RepoRole>('read')
  const [error, setError] = useState<string | null>(null)

  const { data: collaborators = [], isLoading, isError } = useQuery({
    queryKey: ['repo-collaborators', orgSlug, repoSlug],
    queryFn: () => api.listRepositoryCollaborators(token, orgSlug, repoSlug),
    enabled: Boolean(token),
    retry: false,
  })

  const addCollaborator = useMutation({
    mutationFn: () =>
      api.addRepositoryCollaborator(token, orgSlug, repoSlug, {
        user_id: selectedUser!.id,
        role: newRole,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-collaborators', orgSlug, repoSlug] })
      setSelectedUser(null)
      setNewRole('read')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateCollaborator = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: RepoRole }) =>
      api.updateRepositoryCollaborator(token, orgSlug, repoSlug, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-collaborators', orgSlug, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeCollaborator = useMutation({
    mutationFn: (userId: string) =>
      api.removeRepositoryCollaborator(token, orgSlug, repoSlug, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-collaborators', orgSlug, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const collaboratorIds = useMemo(
    () => collaborators.map((collaborator) => collaborator.user.id),
    [collaborators],
  )

  if (isError) {
    return null
  }

  function onAddCollaborator(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser) {
      setError('Select a user to add')
      return
    }
    setError(null)
    addCollaborator.mutate()
  }

  return (
    <div className="app-panel max-w-2xl">
      <div className="app-panel-header flex items-center gap-2">
        <UserPlus size={16} />
        Direct access
      </div>
      <div className="app-panel-body space-y-5">
        <p className="text-sm text-text-secondary">
          Grant push or admin access to users who are not group members, or override access for a specific repository.
          Group owners and admins already have full access.
        </p>

        <form className="flex flex-wrap gap-3 items-start" onSubmit={onAddCollaborator}>
          <UserPicker
            token={token}
            value={selectedUser}
            onChange={setSelectedUser}
            excludeUserIds={collaboratorIds}
            disabled={addCollaborator.isPending}
          />
          <Select
            className="w-36 !py-1.5"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as RepoRole)}
            disabled={addCollaborator.isPending}
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="admin">Admin</option>
          </Select>
          <PrimaryButton type="submit" disabled={addCollaborator.isPending || !selectedUser}>
            {addCollaborator.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Adding…
              </>
            ) : (
              'Add'
            )}
          </PrimaryButton>
        </form>

        {error && (
          <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {error}
          </div>
        )}

        {isLoading && <div className="text-sm text-text-secondary">Loading collaborators…</div>}

        {!isLoading && collaborators.length === 0 && (
          <p className="text-sm text-text-secondary">No direct repository permissions yet.</p>
        )}

        {!isLoading && collaborators.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {collaborators.map((collaborator) => (
                <tr key={collaborator.user.id}>
                  <td>
                    <div className="font-medium text-text">@{collaborator.user.username}</div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {collaborator.user.display_name ?? collaborator.user.email}
                    </div>
                  </td>
                  <td>
                    <Select
                      className="!py-1 text-sm"
                      value={collaborator.role}
                      disabled={updateCollaborator.isPending}
                      onChange={(e) =>
                        updateCollaborator.mutate({
                          userId: collaborator.user.id,
                          role: e.target.value as RepoRole,
                        })
                      }
                    >
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                      <option value="admin">Admin</option>
                    </Select>
                  </td>
                  <td className="text-right">
                    <SecondaryButton
                      type="button"
                      className="px-2 py-1"
                      disabled={removeCollaborator.isPending}
                      onClick={() => {
                        if (
                          window.confirm(`Remove direct access for @${collaborator.user.username}?`)
                        ) {
                          removeCollaborator.mutate(collaborator.user.id)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </SecondaryButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
