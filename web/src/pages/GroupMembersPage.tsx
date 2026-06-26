import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { OrgMember, User } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { UserPicker } from '../components/UserPicker'
import { Card } from '../components/Card'
import { Alert, Breadcrumbs, PageHeader, PrimaryButton } from '../components/ui'
import { Select } from '../components/ui/Input'

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
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug, to: `/groups/${slug}` },
          { label: 'Members' },
        ]}
      />
      <PageHeader
        title="Members"
        subtitle={`Manage who belongs to ${group?.name ?? slug} and their group role.`}
      />

      {error && <Alert>{error}</Alert>}

      {canManage && (
        <Card title="Add member" className="max-w-3xl">
          <form className="space-y-4" onSubmit={onAddMember}>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              Search for an existing account by username, email, or display name.
            </p>
            <div className="flex flex-wrap items-start gap-3">
              <UserPicker
                token={token!}
                value={selectedUser}
                onChange={setSelectedUser}
                excludeUserIds={memberIds}
                disabled={addMember.isPending}
              />
              <Select
                className="w-40"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as OrgRole)}
                disabled={addMember.isPending}
              >
                {isOwner && <option value="owner">Owner</option>}
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </Select>
              <PrimaryButton
                type="submit"
                disabled={addMember.isPending || !selectedUser}
                startIcon={addMember.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              >
                {addMember.isPending ? 'Adding…' : 'Add member'}
              </PrimaryButton>
            </div>
          </form>
        </Card>
      )}

      <div className="shell-card max-w-3xl">
        <div className="shell-card-header">
          <span>All members</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{members.length}</span>
        </div>

        {isLoading && (
          <div className="shell-card-body py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            Loading…
          </div>
        )}

        {!isLoading && members.length > 0 && (
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  {canManage && <th />}
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
                        <div className="font-medium text-gray-800 dark:text-white/90">
                          @{member.user.username}
                        </div>
                        <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                          {member.user.display_name ?? member.user.email}
                        </div>
                      </td>
                      <td>
                        {canEditTarget ? (
                          <Select
                            className="!py-1.5 text-theme-sm"
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
                          </Select>
                        ) : (
                          <StatusBadge variant={roleVariant(member.role)}>{member.role}</StatusBadge>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          {canEditTarget && !isSelf && (
                            <div className="flex justify-end">
                              <button
                                type="button"
                                className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                                disabled={removeMember.isPending}
                                title="Remove member"
                                onClick={() => {
                                  if (window.confirm(`Remove @${member.user.username} from this group?`)) {
                                    removeMember.mutate(member.user.id)
                                  }
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="max-w-3xl space-y-2 text-theme-sm text-gray-500 dark:text-gray-400">
        <p>
          <strong className="text-gray-800 dark:text-white/90">Owner / Admin</strong> — can push to all repositories in the group.
        </p>
        <p>
          <strong className="text-gray-800 dark:text-white/90">Member</strong> — can read private repositories; push only with a direct repository role.
        </p>
      </div>
    </div>
  )
}
