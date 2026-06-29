import type { ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { parseGroupRoute } from '../lib/groupRoute'
import {
  parseNewProjectRoute,
  parseProjectRoute,
  parseProjectSubRoute,
} from '../lib/projectRoute'
import { CommitDetailPage } from '../pages/CommitDetailPage'
import { GroupAuditPage } from '../pages/GroupAuditPage'
import { GroupCustomRolesPage } from '../pages/GroupCustomRolesPage'
import { GroupDetailPage } from '../pages/GroupDetailPage'
import { GroupImportPage } from '../pages/GroupImportPage'
import { GroupMachineUsersPage } from '../pages/GroupMachineUsersPage'
import { GroupMembersPage } from '../pages/GroupMembersPage'
import { GroupSecretsPage } from '../pages/GroupSecretsPage'
import { GroupSettingsPage } from '../pages/GroupSettingsPage'
import { GroupTeamsPage } from '../pages/GroupTeamsPage'
import { IssueDetailPage } from '../pages/IssueDetailPage'
import { NewProjectPage } from '../pages/NewProjectPage'
import { PipelineRunDetailPage } from '../pages/PipelineRunDetailPage'
import { ProjectDetailPage } from '../pages/ProjectDetailPage'
import { PullRequestDetailPage } from '../pages/PullRequestDetailPage'
import { RegistryPage } from '../pages/RegistryPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Routes under `/groups/*` (nested org paths). React Router splat only works at the end. */
export function GroupAreaRouter() {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()

  if (parseNewProjectRoute(pathname)) {
    return (
      <RequireAuth>
        <NewProjectPage />
      </RequireAuth>
    )
  }

  const projectSub = parseProjectSubRoute(pathname)
  if (projectSub?.kind === 'commit') return <CommitDetailPage />
  if (projectSub?.kind === 'issue') return <IssueDetailPage />
  if (projectSub?.kind === 'pull') return <PullRequestDetailPage />
  if (projectSub?.kind === 'pipeline') return <PipelineRunDetailPage />

  if (parseProjectRoute(pathname, searchParams)) {
    return <ProjectDetailPage />
  }

  const group = parseGroupRoute(pathname)
  if (!group) return <Navigate to="/groups" replace />

  let page: ReactNode
  switch (group.tab) {
    case 'registry':
      page = <RegistryPage />
      break
    case 'settings':
      page = <GroupSettingsPage />
      break
    case 'members':
      page = <GroupMembersPage />
      break
    case 'teams':
      page = <GroupTeamsPage />
      break
    case 'roles':
      page = <GroupCustomRolesPage />
      break
    case 'machine-users':
      page = <GroupMachineUsersPage />
      break
    case 'audit':
      page = <GroupAuditPage />
      break
    case 'secrets':
      page = <GroupSecretsPage />
      break
    case 'import':
      page = <GroupImportPage />
      break
    default:
      page = <GroupDetailPage />
      break
  }

  return <RequireAuth>{page}</RequireAuth>
}
