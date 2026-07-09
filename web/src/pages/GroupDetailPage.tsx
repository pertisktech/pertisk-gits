import { useQuery } from '@tanstack/react-query'
import { Plus, Settings } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GroupChildrenPanel } from '../components/GroupChildrenPanel'
import { GroupLandingHero } from '../components/GroupLandingHero'
import { ImportMenuDropdown } from '../components/ImportMenuDropdown'
import { Breadcrumbs, LinkButton } from '../components/ui'
import { useGroupFromRoute } from '../hooks/useGroupFromRoute'
import { groupBreadcrumbItems } from '../lib/groupRoute'

export function GroupDetailPage() {
  const { token, user } = useAuth()
  const { orgPath, group, groups } = useGroupFromRoute()

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const { data: subgroups = [], isLoading: subgroupsLoading } = useQuery({
    queryKey: ['subgroups', orgPath],
    queryFn: () => api.listSubgroups(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['repositories', orgPath, { recursive: false }],
    queryFn: () => api.listRepositories(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const canManage =
    members.find((member) => member.user.id === user?.id)?.role === 'owner' ||
    members.find((member) => member.user.id === user?.id)?.role === 'admin'

  const basePath = `/groups/${orgPath}`

  return (
    <>
      <Breadcrumbs
        items={groupBreadcrumbItems(orgPath, groups).map((item, i, arr) =>
          i === arr.length - 1 ? { label: item.label } : item,
        )}
      />

      <GroupLandingHero
        name={group?.name ?? orgPath}
        slug={group?.slug ?? orgPath.split('/').pop() ?? orgPath}
        path={orgPath}
        description={group?.description}
        subgroupCount={subgroups.length}
        projectCount={projects.length}
        statsLoading={subgroupsLoading || isLoading}
      />

      <div className="mb-4 flex justify-end gap-2">
        {canManage && (
          <LinkButton to={`${basePath}/settings`}>
            <Settings size={14} />
            Settings
          </LinkButton>
        )}
        {canManage && (
          <ImportMenuDropdown basePath={basePath} />
        )}
        {canManage && (
          <LinkButton to={`/groups/new?parent=${encodeURIComponent(orgPath)}`}>
            <Plus size={14} />
            New subgroup
          </LinkButton>
        )}
        <LinkButton to={`${basePath}/projects/new`} primary>
          <Plus size={14} />
          New repository
        </LinkButton>
      </div>

      <GroupChildrenPanel
        orgPath={orgPath}
        basePath={basePath}
        subgroups={subgroups}
        subgroupsLoading={subgroupsLoading}
        projects={projects}
        projectsLoading={isLoading}
        projectsError={error as Error | null}
        allGroups={groups}
        canManage={canManage}
      />
    </>
  )
}
