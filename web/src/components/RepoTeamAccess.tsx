import { useQuery } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { api } from '../api/client'

interface RepoTeamAccessProps {
  token: string
  orgSlug: string
  repoSlug: string
  embedded?: boolean
}

export function RepoTeamAccess({ token, orgSlug, repoSlug, embedded = false }: RepoTeamAccessProps) {
  const { data: teams = [], isLoading, isError } = useQuery({
    queryKey: ['repo-team-access', orgSlug, repoSlug],
    queryFn: () => api.listRepositoryTeamAccess(token, orgSlug, repoSlug),
    enabled: Boolean(token),
    retry: false,
  })

  if (isError) {
    return null
  }

  const body = (
    <div className="space-y-3">
        {!embedded && (
          <p className="text-sm text-text-secondary">
            Teams that grant access to this repository. Manage teams from the group Teams page.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading team access…</p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-text-secondary">No team grants for this repository.</p>
        ) : (
          <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
            {teams.map((team) => (
              <li key={team.team_id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text">{team.team_name}</div>
                  <div className="text-xs font-mono text-muted">{team.team_slug}</div>
                </div>
                <span className="text-xs capitalize text-text-secondary">{team.role}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )

  if (embedded) return body

  return (
    <div className="app-panel max-w-2xl">
      <div className="app-panel-header flex items-center gap-2">
        <UsersRound size={16} />
        Team access
      </div>
      <div className="app-panel-body">{body}</div>
    </div>
  )
}
