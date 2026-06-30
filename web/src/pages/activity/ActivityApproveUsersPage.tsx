import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, PageHeader, TablePagination } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'
import { useClientPagination } from '../../lib/pagination'

export function ActivityApproveUsersPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', 'pending'],
    queryFn: () => api.listAdminUsers(token!, 'pending'),
    enabled: Boolean(token),
  })

  const {
    items: pageUsers,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(users)

  const approveUser = useMutation({
    mutationFn: (userId: string) => api.approveAdminUser(token!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-system'] })
      queryClient.invalidateQueries({ queryKey: ['activity-pending-users-count'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const rejectUser = useMutation({
    mutationFn: (userId: string) => api.rejectAdminUser(token!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-system'] })
      queryClient.invalidateQueries({ queryKey: ['activity-pending-users-count'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Activity', to: '/activity/merge-requests' },
          { label: 'Approve users' },
        ]}
      />
      <PageHeader
        title="Approve users"
        subtitle="Review and approve self-registrations waiting for platform access."
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>Pending registrations</span>
          <span className="font-normal text-text-secondary">{users.length}</span>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-text-secondary text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading pending users…
          </div>
        )}

        {!isLoading && users.length === 0 && (
          <div className="p-8 text-center text-text-secondary text-sm">
            No users waiting for approval.
          </div>
        )}

        {!isLoading && users.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Registered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageUsers.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div className="font-medium text-text">@{entry.username}</div>
                    <div className="text-xs text-text-secondary">{entry.email}</div>
                    {entry.display_name && (
                      <div className="text-xs text-muted mt-0.5">{entry.display_name}</div>
                    )}
                  </td>
                  <td className="text-sm text-text-secondary">
                    <StatusBadge variant="yellow">Pending</StatusBadge>
                    <div className="mt-1">{formatDateTime(entry.created_at)}</div>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-dashboard-success disabled:opacity-40"
                        title="Approve user"
                        disabled={approveUser.isPending}
                        onClick={() => approveUser.mutate(entry.id)}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-dashboard-danger disabled:opacity-40"
                        title="Reject registration"
                        disabled={rejectUser.isPending}
                        onClick={() => {
                          if (window.confirm(`Reject registration for @${entry.username}?`)) {
                            rejectUser.mutate(entry.id)
                          }
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            itemLabel="users"
          />
        )}
      </div>
    </>
  )
}
