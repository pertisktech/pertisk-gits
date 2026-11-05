import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { findGroupByPath, groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { groupBreadcrumbItems } from '../lib/groupRoute'
import { parseGroupSettingsSection } from '../lib/groupSettingsRoute'
import { GroupDangerZone } from '../components/GroupDangerZone'
import { SecretsPanel } from '../components/SecretsPanel'
import {
  GROUP_SETTINGS_SECTION_META,
  GroupSettingsNav,
} from '../components/settings/GroupSettingsNav'
import { SettingsPanel } from '../components/settings/SettingsPanel'
import { Breadcrumbs, LinkButton, PrimaryButton } from '../components/ui'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function GroupSettingsPage() {
  const orgPath = useOrgPathParam()
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const section = parseGroupSettingsSection(searchParams.get('section'))
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
  const basePath = group ? groupBaseUrl(group) : `/groups/${orgPath}`

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
        navigate(`${nextPath}/settings?section=general`, { replace: true })
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

  if (!token) return null

  const slugChanged = newSlug !== group.slug
  const meta = GROUP_SETTINGS_SECTION_META[section]

  return (
    <div className="repo-settings">
      <Breadcrumbs
        items={[...groupBreadcrumbItems(orgPath, groups), { label: 'Settings' }]}
      />

      <header className="repo-settings-page-header">
        <h1 className="repo-settings-page-title">Group settings</h1>
        <p className="repo-settings-page-desc">
          Manage configuration and automation for this group.
        </p>
      </header>

      <GroupSettingsNav basePath={basePath} />

      <div className="repo-settings-content">
        <p className="repo-settings-section-intro">{meta.description}</p>

        {section === 'general' && (
          <>
            <SettingsPanel
              title="Group details"
              description="Basic information shown in the group list and clone paths."
              icon={meta.icon}
              footer={
                <>
                  {saved && (
                    <span className="text-sm text-dashboard-success">Settings saved.</span>
                  )}
                  <PrimaryButton type="submit" form="group-general-form" disabled={updateGroup.isPending}>
                    {updateGroup.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save changes'
                    )}
                  </PrimaryButton>
                  <LinkButton to={groupBaseUrl(group)}>Cancel</LinkButton>
                </>
              }
            >
              <form id="group-general-form" onSubmit={onSubmit} className="space-y-4">
                {updateGroup.error && (
                  <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                    {(updateGroup.error as Error).message}
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
              </form>
            </SettingsPanel>

            {isOwner && (
              <div className="mt-6">
                <GroupDangerZone token={token} orgPath={orgPath} group={group} allGroups={groups} />
              </div>
            )}
          </>
        )}

        {section === 'automation' && (
          <SettingsPanel
            title="CI/CD variables"
            description="Secrets and variables for every project in this group. Repository entries with the same key and environment override these. Server entries are overridden by group entries."
          >
            <SecretsPanel
              embedded
              token={token}
              title="Group CI/CD"
              description=""
              queryKey={['org-secrets', orgPath]}
              listSecrets={() => api.listOrgSecrets(token, orgPath)}
              createSecret={(payload) => api.createOrgSecret(token, orgPath, payload)}
              updateSecret={(id, payload) => api.updateOrgSecret(token, orgPath, id, payload)}
              deleteSecret={(id) => api.deleteOrgSecret(token, orgPath, id)}
            />
          </SettingsPanel>
        )}
      </div>
    </div>
  )
}
