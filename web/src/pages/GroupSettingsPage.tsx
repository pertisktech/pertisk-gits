import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Alert, Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'
import { FieldLabel, Input, Textarea } from '../components/ui/Input'

export function GroupSettingsPage() {
  const { slug = '' } = useParams()
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
  const group = groups.find((item) => item.slug === slug)

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.listOrganizationMembers(token!, slug),
    enabled: Boolean(token && slug),
  })

  const myRole = useMemo(
    () => members.find((member) => member.user.id === user?.id)?.role,
    [members, user?.id],
  )
  const canManage = myRole === 'owner' || myRole === 'admin'

  useEffect(() => {
    if (!group) return
    setName(group.name)
    setNewSlug(group.slug)
    setDescription(group.description ?? '')
  }, [group])

  const updateGroup = useMutation({
    mutationFn: () =>
      api.updateOrganization(token!, slug, {
        name,
        slug: newSlug,
        description: description.trim() ? description : '',
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['repositories', slug] })
      queryClient.invalidateQueries({ queryKey: ['org-members', slug] })
      if (updated.slug !== slug) {
        queryClient.invalidateQueries({ queryKey: ['repositories', updated.slug] })
        queryClient.invalidateQueries({ queryKey: ['org-members', updated.slug] })
        navigate(`/groups/${updated.slug}/settings`, { replace: true })
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
      <div className="flex items-center gap-2 py-8 text-theme-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Loading group settings…
      </div>
    )
  }

  if (!group) {
    return <Alert>Group not found.</Alert>
  }

  if (!canManage) {
    return <Navigate to={`/groups/${slug}`} replace />
  }

  const slugChanged = newSlug !== group.slug

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group.name, to: `/groups/${slug}` },
          { label: 'Settings' },
        ]}
      />
      <PageHeader
        title="Group settings"
        subtitle="Update the group name, URL slug, and description."
      />

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {updateGroup.error && <Alert>{(updateGroup.error as Error).message}</Alert>}
          {saved && (
            <div className="rounded-lg border border-success-500/30 bg-success-50 px-4 py-3 text-theme-sm text-success-600 dark:bg-success-500/10 dark:text-success-500">
              Group settings saved.
            </div>
          )}

          <FieldLabel label="Group name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FieldLabel>

          <FieldLabel label="Group URL">
            <Input
              className="font-mono"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              required
            />
            <span className="mt-1 block font-mono text-theme-xs text-gray-500 dark:text-gray-400">
              pertisk-gits/{newSlug || 'your-group'}
            </span>
            {slugChanged && (
              <span className="mt-1 block text-theme-xs text-error-500">
                Changing the slug updates clone URLs and moves repository storage on disk.
              </span>
            )}
          </FieldLabel>

          <FieldLabel label="Description (optional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FieldLabel>

          <div className="flex gap-2 pt-2">
            <PrimaryButton type="submit" disabled={updateGroup.isPending}>
              {updateGroup.isPending ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
            <LinkButton to={`/groups/${slug}`}>Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </>
  )
}
