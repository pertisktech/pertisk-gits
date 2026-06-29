import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { OrgMember, User } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { findGroupByPath } from '../lib/groupPath'
import { StatusBadge } from '../components/StatusBadge'
import { UserPicker } from '../components/UserPicker'
import { PrimaryButton, SecondaryButton, Select } from '../components/ui'

type OrgRole = OrgMember['role']

function roleVariant(role: OrgRole) {
  if (role === 'owner') return 'violet' as const
  if (role === 'admin') return 'green' as const
  return 'gray' as const
}

export function GroupMembersPage() {
  const orgPath = useOrgPathParam()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<OrgRole>('member')
  const [newCustomRoleId, setNewCustomRoleId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = findGroupByPath(groups, orgPath)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const myMembership = useMemo(
    () => members.find((member) => member.user.id === user?.id),
    [members, user?.id],
  )
  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'admin'
  const isOwner = myMembership?.role === 'owner'

  const { data: customRoles = [] } = useQuery({
    queryKey: ['custom-roles', orgPath],
    queryFn: () => api.listCustomRoles(token!, orgPath),
    enabled: Boolean(token && orgPath && canManage),
  })

  const addMember = useMutation({
    mutationFn: () =>
      api.addOrganizationMember(token!, orgPath, {
        user_id: selectedUser!.id,
        role: newRole,
        custom_role_id: newCustomRoleId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgPath] })
      setSelectedUser(null)
      setNewRole('member')
      setNewCustomRoleId('')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateMember = useMutation({
    mutationFn: ({
      userId,
      role,
      custom_role_id,
    }: {
      userId: string
      role: OrgRole
      custom_role_id?: string | null
    }) => api.updateOrganizationMember(token!, orgPath, userId, { role, custom_role_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgPath] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeOrganizationMember(token!, orgPath, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgPath] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function onAddMember(event: FormEvent) {
    event.preventDefault()
    if (!selectedUser) {
      setError('Select a user to add')
      return
    }
    setError(null)
    addMember.mutate()
  }

  const memberIds = useMemo(() => members.map((member) => member.user.id), [members])

  function roleOptionsForTarget(target: OrgMember) {
    const options: OrgRole[] = isOwner ? ['owner', 'admin', 'member'] : ['admin', 'member']
    if (target.role === 'owner' && !isOwner) {
      return ['owner'] as OrgRole[]
    }
    return options
  }

  return (
    <>
      <div className="app-repo-header mb-4">
        <h1 className="app-repo-title">
          <span>Members</span>
        </h1>
        <p className="app-repo-desc">
          Manage who belongs to {group?.name ?? orgPath} and their group role.
        </p>
      </div>

      {canManage && (
        <div className="app-panel max-w-3xl mb-5">
          <div className="app-panel-header flex items-center gap-2">
            <UserPlus size={16} />
            Add member
          </div>
          <form className="app-panel-body space-y-4" onSubmit={onAddMember}>
            <p className="text-sm text-text-secondary">
              Search for an existing account by username, email, or display name.
            </p>
            <div className="flex flex-wrap gap-3 items-start">
              <UserPicker
                token={token!}
                value={selectedUser}
                onChange={setSelectedUser}
                excludeUserIds={memberIds}
                disabled={addMember.isPending}
              />
              <Select
                className="w-40 !py-1.5"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as OrgRole)}
                disabled={addMember.isPending}
              >
                {isOwner && <option value="owner">Owner</option>}
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </Select>
              {newRole === 'member' && customRoles.length > 0 && (
                <Select
                  className="w-44 !py-1.5"
                  value={newCustomRoleId}
                  onChange={(e) => setNewCustomRoleId(e.target.value)}
                  disabled={addMember.isPending}
                >
                  <option value="">No custom role</option>
                  {customRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              )}
              <PrimaryButton type="submit" disabled={addMember.isPending || !selectedUser}>
                {addMember.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  'Add member'
                )}
              </PrimaryButton>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm max-w-3xl">
          {error}
        </div>
      )}

      <div className="app-panel max-w-3xl">
        <div className="app-panel-header flex items-center justify-between">
          <span>Members</span>
          <span className="font-normal text-text-secondary">{members.length}</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}

        {!isLoading && members.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Custom role</th>
                {canManage && <th className="w-28" />}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.user.id === user?.id
                const canEditTarget =
                  canManage && (isOwner || member.role !== 'owner') && !(member.role === 'owner' && !isOwner)

                return (
                  <tr key={member.user.id}>
                    <td>
                      <div className="font-medium text-text">@{member.user.username}</div>
                      <div className="text-xs text-text-secondary mt-0.5">
                        {member.user.display_name ?? member.user.email}
                      </div>
                    </td>
                    <td>
                      {canEditTarget ? (
                        <Select
                          className="!py-1 text-sm"
                          value={member.role}
                          disabled={updateMember.isPending}
                          onChange={(e) =>
                            updateMember.mutate({
                              userId: member.user.id,
                              role: e.target.value as OrgRole,
                              custom_role_id: member.custom_role?.id ?? null,
                            })
                          }
                        >
                          {roleOptionsForTarget(member).map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <StatusBadge variant={roleVariant(member.role)}>{member.role}</StatusBadge>
                      )}
                    </td>
                    <td>
                      {canEditTarget && member.role === 'member' ? (
                        <Select
                          className="!py-1 text-sm"
                          value={member.custom_role?.id ?? ''}
                          disabled={updateMember.isPending}
                          onChange={(e) =>
                            updateMember.mutate({
                              userId: member.user.id,
                              role: member.role,
                              custom_role_id: e.target.value || null,
                            })
                          }
                        >
                          <option value="">None</option>
                          {customRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </Select>
                      ) : member.custom_role ? (
                        <span className="text-sm text-text">{member.custom_role.name}</span>
                      ) : (
                        <span className="text-sm text-text-secondary">—</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="text-right">
                        {canEditTarget && !isSelf && (
                          <SecondaryButton
                            type="button"
                            className="px-2 py-1"
                            disabled={removeMember.isPending}
                            onClick={() => {
                              if (window.confirm(`Remove @${member.user.username} from this group?`)) {
                                removeMember.mutate(member.user.id)
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </SecondaryButton>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="max-w-3xl mt-5 text-sm text-text-secondary space-y-2">
        <p>
          <strong className="text-text">Owner / Admin</strong> — can push to all repositories in the group.
        </p>
        <p>
          <strong className="text-text">Member</strong> — can read private repositories; push only with a direct repository role, team grant, or custom role default access.
        </p>
        <p>
          <strong className="text-text">Custom roles</strong> — optional fine-grained permissions assigned to members on the Custom roles page.
        </p>
      </div>
    </>
  )
}
