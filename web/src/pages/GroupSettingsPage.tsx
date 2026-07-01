import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { findGroupByPath, groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { groupBreadcrumbItems } from '../lib/groupRoute'
import { Card } from '../components/Card'
import { GroupDangerZone } from '../components/GroupDangerZone'
import { Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function GroupSettingsPage() {
  const orgPath = useOrgPathParam()
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [description, setDescription] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = findGroupByPath(groups, orgPath)

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const myRole = useMemo(
    () => members.find((member) => member.user.id === user?.id)?.role,
    [members, user?.id],
  )
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  useEffect(() => {
    if (!group) return
    setName(group.name)
    setNewSlug(group.slug)
    setDescription(group.description ?? '')
  }, [group])

  const updateGroup = useMutation({
    mutationFn: () =>
      api.updateOrganization(token!, orgPath, {
        name,
        slug: newSlug,
        description: description.trim() ? description : '',
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['repositories', orgPath] })
      queryClient.invalidateQueries({ queryKey: ['org-members', orgPath] })
      if (groupUrlPath(updated) !== orgPath) {
        const nextPath = groupBaseUrl(updated)
        queryClient.invalidateQueries({ queryKey: ['repositories', nextPath] })
        queryClient.invalidateQueries({ queryKey: ['org-members', nextPath] })
        navigate(`${nextPath}/settings`, { replace: true })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    updateGroup.mutate()
  }

  if (groupsLoading || membersLoading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading group settings…
      </div>
    )
  }

  if (!group) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        Group not found.
      </div>
    )
  }

  if (!canManage) {
    return <Navigate to={groupBaseUrl(group)} replace />
  }

  const slugChanged = newSlug !== group.slug

  return (
    <>
      <Breadcrumbs
        items={[...groupBreadcrumbItems(orgPath, groups), { label: 'Settings' }]}
      />
      <PageHeader
        title="Group settings"
        subtitle="Update the group name, URL slug, and description."
      />

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {updateGroup.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {(updateGroup.error as Error).message}
            </div>
          )}
          {saved && (
            <div className="p-3 rounded-lg border border-green-g1/30 bg-dashboard-success-bg text-dashboard-success text-sm">
              Group settings saved.
            </div>
          )}

          <label className="block text-sm font-semibold text-text">
            Group name
            <input
              className={`${fieldClass} mt-1.5`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="block text-sm font-semibold text-text">
            Group URL
            <input
              className={`${fieldClass} mt-1.5 font-mono`}
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              required
            />
            <span className="text-xs text-text-secondary mt-1 block font-mono">
              pertisk-gits/{newSlug || 'your-group'}
            </span>
            {slugChanged && (
              <span className="text-xs text-dashboard-danger mt-1 block">
                Changing the slug updates clone URLs and moves repository storage on disk.
              </span>
            )}
          </label>

          <label className="block text-sm font-semibold text-text">
            Description (optional)
            <textarea
              className={`${fieldClass} mt-1.5`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>

          <div className="flex gap-2 pt-2">
            <PrimaryButton type="submit" disabled={updateGroup.isPending}>
              {updateGroup.isPending ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
            <LinkButton to={groupBaseUrl(group)}>Cancel</LinkButton>
          </div>
        </form>
      </Card>

      {isOwner && (
        <div className="max-w-xl mt-6">
          <GroupDangerZone token={token!} orgPath={orgPath} group={group} allGroups={groups} />
        </div>
      )}
    </>
  )
}
