import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { OrgMember, User } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { UserPicker } from '../components/UserPicker'
import { Breadcrumbs, PageHeader, PrimaryButton, SecondaryButton } from '../components/ui'

type OrgRole = OrgMember['role']

function roleVariant(role: OrgRole) {
  if (role === 'owner') return 'violet' as const
  if (role === 'admin') return 'green' as const
  return 'gray' as const
}

export function GroupMembersPage() {
  const { slug = '' } = useParams()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<OrgRole>('member')
  const [error, setError] = useState<string | null>(null)

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === slug)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.listOrganizationMembers(token!, slug),
    enabled: Boolean(token && slug),
  })

  const myMembership = useMemo(
    () => members.find((member) => member.user.id === user?.id),
    [members, user?.id],
  )
  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'admin'
  const isOwner = myMembership?.role === 'owner'

  const addMember = useMutation({
    mutationFn: () =>
      api.addOrganizationMember(token!, slug, {
        user_id: selectedUser!.id,
        role: newRole,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', slug] })
      setSelectedUser(null)
      setNewRole('member')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      api.updateOrganizationMember(token!, slug, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', slug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeOrganizationMember(token!, slug, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', slug] })
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
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug, to: `/groups/${slug}` },
          { label: 'Members' },
        ]}
      />
      <PageHeader
        title="Group members"
        subtitle={
          <>
            Manage who belongs to <strong className="text-text">{group?.name ?? slug}</strong> and their group role.
          </>
        }
      />

      {canManage && (
        <div className="gogs-panel max-w-3xl mb-5">
          <div className="gogs-panel-header flex items-center gap-2">
            <UserPlus size={16} />
            Add member
          </div>
          <form className="gogs-panel-body space-y-4" onSubmit={onAddMember}>
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
              <select
                className="gogs-field w-40"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as OrgRole)}
                disabled={addMember.isPending}
              >
                {isOwner && <option value="owner">Owner</option>}
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
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

      <div className="gogs-panel max-w-3xl">
        <div className="gogs-panel-header flex items-center justify-between">
          <span>Members</span>
          <span className="font-normal text-text-secondary">{members.length}</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}

        {!isLoading && members.length > 0 && (
          <table className="gogs-list-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
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
                        <select
                          className="gogs-field py-1 text-sm"
                          value={member.role}
                          disabled={updateMember.isPending}
                          onChange={(e) =>
                            updateMember.mutate({
                              userId: member.user.id,
                              role: e.target.value as OrgRole,
                            })
                          }
                        >
                          {roleOptionsForTarget(member).map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge variant={roleVariant(member.role)}>{member.role}</StatusBadge>
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
          <strong className="text-text">Member</strong> — can read private repositories; push only with a direct repository role.
        </p>
      </div>
    </>
  )
}
