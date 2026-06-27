import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { TeamSummary, User } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { UserPicker } from '../components/UserPicker'
import { PrimaryButton, SecondaryButton, Select } from '../components/ui'

type RepoRole = 'admin' | 'write' | 'read'

export function GroupTeamsPage() {
  const { slug = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [teamName, setTeamName] = useState('')
  const [teamDescription, setTeamDescription] = useState('')
  const [selectedTeamSlug, setSelectedTeamSlug] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [repoSlug, setRepoSlug] = useState('')
  const [repoRole, setRepoRole] = useState<RepoRole>('read')
  const [error, setError] = useState<string | null>(null)

  const teamsKey = ['teams', slug]
  const { data: teams = [], isLoading } = useQuery({
    queryKey: teamsKey,
    queryFn: () => api.listTeams(token!, slug),
    enabled: Boolean(token && slug),
  })

  const { data: repositories = [] } = useQuery({
    queryKey: ['repositories', slug],
    queryFn: () => api.listRepositories(token!, slug),
    enabled: Boolean(token && slug),
  })

  const selectedTeam = useMemo(
    () => teams.find((team) => team.slug === selectedTeamSlug) ?? null,
    [teams, selectedTeamSlug],
  )

  const membersKey = ['team-members', slug, selectedTeamSlug]
  const { data: teamMembers = [] } = useQuery({
    queryKey: membersKey,
    queryFn: () => api.listTeamMembers(token!, slug, selectedTeamSlug!),
    enabled: Boolean(token && slug && selectedTeamSlug),
  })

  const reposKey = ['team-repos', slug, selectedTeamSlug]
  const { data: teamRepos = [] } = useQuery({
    queryKey: reposKey,
    queryFn: () => api.listTeamRepositories(token!, slug, selectedTeamSlug!),
    enabled: Boolean(token && slug && selectedTeamSlug),
  })

  const createTeam = useMutation({
    mutationFn: () =>
      api.createTeam(token!, slug, {
        name: teamName.trim(),
        description: teamDescription.trim() || undefined,
      }),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: teamsKey })
      setTeamName('')
      setTeamDescription('')
      setSelectedTeamSlug(team.slug)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteTeam = useMutation({
    mutationFn: (teamSlug: string) => api.deleteTeam(token!, slug, teamSlug),
    onSuccess: (_data, teamSlug) => {
      queryClient.invalidateQueries({ queryKey: teamsKey })
      if (selectedTeamSlug === teamSlug) setSelectedTeamSlug(null)
    },
  })

  const addMember = useMutation({
    mutationFn: () =>
      api.addTeamMember(token!, slug, selectedTeamSlug!, { user_id: selectedUser!.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKey })
      queryClient.invalidateQueries({ queryKey: teamsKey })
      setSelectedUser(null)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeTeamMember(token!, slug, selectedTeamSlug!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKey })
      queryClient.invalidateQueries({ queryKey: teamsKey })
    },
  })

  const setRepoAccess = useMutation({
    mutationFn: () =>
      api.setTeamRepositoryAccess(token!, slug, selectedTeamSlug!, {
        repo_slug: repoSlug,
        role: repoRole,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reposKey })
      queryClient.invalidateQueries({ queryKey: teamsKey })
      setRepoSlug('')
      setRepoRole('read')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const removeRepoAccess = useMutation({
    mutationFn: (targetRepoSlug: string) =>
      api.removeTeamRepositoryAccess(token!, slug, selectedTeamSlug!, targetRepoSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reposKey })
      queryClient.invalidateQueries({ queryKey: teamsKey })
    },
  })

  function onCreateTeam(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createTeam.mutate()
  }

  if (!token) return null

  return (
    <div className="space-y-5">
      <div className="app-repo-header">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text">Teams</h1>
          <p className="text-sm text-text-secondary">
            Group members into teams and grant repository access templates in bulk.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-5">
          <div className="app-panel">
            <div className="app-panel-header flex items-center gap-2">
              <UsersRound size={15} className="text-primary" />
              Create team
            </div>
            <form className="app-panel-body space-y-4" onSubmit={onCreateTeam}>
              <input
                className="app-field"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Team name"
                required
              />
              <textarea
                className="app-field"
                rows={2}
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                placeholder="Description (optional)"
              />
              {error && !selectedTeam && (
                <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {error}
                </div>
              )}
              <PrimaryButton type="submit" disabled={createTeam.isPending}>
                {createTeam.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create team'
                )}
              </PrimaryButton>
            </form>
          </div>

          <div className="app-panel">
            <div className="app-panel-header">All teams</div>
            <div className="app-panel-body">
              {isLoading ? (
                <p className="text-sm text-text-secondary">Loading teams…</p>
              ) : teams.length === 0 ? (
                <p className="text-sm text-text-secondary">No teams yet.</p>
              ) : (
                <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
                  {teams.map((team: TeamSummary) => (
                    <li key={team.id}>
                      <button
                        type="button"
                        className={`w-full px-4 py-3 text-left hover:bg-naturals-n5/40 ${
                          selectedTeamSlug === team.slug ? 'bg-naturals-n5/60' : ''
                        }`}
                        onClick={() => setSelectedTeamSlug(team.slug)}
                      >
                        <div className="text-sm font-medium text-text">{team.name}</div>
                        <div className="text-xs text-text-secondary mt-1">
                          {team.member_count} members · {team.repository_count} repositories
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="app-panel">
          <div className="app-panel-header">
            {selectedTeam ? selectedTeam.name : 'Select a team'}
          </div>
          <div className="app-panel-body space-y-6">
            {!selectedTeam ? (
              <p className="text-sm text-text-secondary">
                Choose a team to manage members and repository access.
              </p>
            ) : (
              <>
                <div className="flex justify-end">
                  <SecondaryButton
                    type="button"
                    onClick={() => deleteTeam.mutate(selectedTeam.slug)}
                  >
                    Delete team
                  </SecondaryButton>
                </div>

                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-text">Members</h3>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[220px] flex-1">
                      <UserPicker
                        token={token}
                        value={selectedUser}
                        onChange={setSelectedUser}
                        excludeUserIds={teamMembers.map((entry) => entry.user.id)}
                      />
                    </div>
                    <PrimaryButton
                      type="button"
                      disabled={!selectedUser || addMember.isPending}
                      onClick={() => addMember.mutate()}
                    >
                      <UserPlus size={14} />
                      Add
                    </PrimaryButton>
                  </div>
                  <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
                    {teamMembers.map((entry) => (
                      <li
                        key={entry.user.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <span className="text-sm text-text">@{entry.user.username}</span>
                        <button
                          type="button"
                          onClick={() => removeMember.mutate(entry.user.id)}
                          className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger"
                          data-no-global-button-hover="true"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-text">Repository access</h3>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select
                      id="team-repo"
                      label="Repository"
                      value={repoSlug}
                      onChange={(e) => setRepoSlug(e.target.value)}
                    >
                      <option value="">Select repository</option>
                      {repositories.map((repo) => (
                        <option key={repo.id} value={repo.slug}>
                          {repo.slug}
                        </option>
                      ))}
                    </Select>
                    <Select
                      id="team-repo-role"
                      label="Role"
                      value={repoRole}
                      onChange={(e) => setRepoRole(e.target.value as RepoRole)}
                    >
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                      <option value="admin">Admin</option>
                    </Select>
                    <PrimaryButton
                      type="button"
                      disabled={!repoSlug || setRepoAccess.isPending}
                      onClick={() => setRepoAccess.mutate()}
                    >
                      Grant access
                    </PrimaryButton>
                  </div>
                  <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
                    {teamRepos.map((entry) => (
                      <li
                        key={entry.repository_id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-sm font-medium text-text">{entry.repo_slug}</div>
                          <div className="text-xs text-text-secondary capitalize">{entry.role}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRepoAccess.mutate(entry.repo_slug)}
                          className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger"
                          data-no-global-button-hover="true"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                {error && selectedTeam && (
                  <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
