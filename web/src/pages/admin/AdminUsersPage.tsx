import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { AdminUser } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, Checkbox, PageHeader, PrimaryButton, SecondaryButton, TablePagination } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'
import { useClientPagination } from '../../lib/pagination'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

const EMPTY_FORM = {
  username: '',
  email: '',
  password: '',
  display_name: '',
  is_super_admin: false,
}

type UserFilter = 'all' | 'pending' | 'approved' | 'rejected'

function approvalBadge(status: AdminUser['approval_status']) {
  switch (status) {
    case 'pending':
      return <StatusBadge variant="yellow">Pending</StatusBadge>
    case 'rejected':
      return <StatusBadge variant="red">Rejected</StatusBadge>
    default:
      return <StatusBadge variant="green">Approved</StatusBadge>
  }
}

export function AdminUsersPage() {
  const { token, user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filter, setFilter] = useState<UserFilter>('all')

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', filter],
    queryFn: () =>
      api.listAdminUsers(
        token!,
        filter === 'all' ? undefined : filter,
      ),
    enabled: Boolean(token),
  })

  const {
    items: pageUsers,
    page,
    setPage,
    resetPage,
    pageSize,
    total,
  } = useClientPagination(users)

  useEffect(() => {
    resetPage()
  }, [filter, resetPage])

  const createUser = useMutation({
    mutationFn: () =>
      api.createAdminUser(token!, {
        username: form.username,
        email: form.email,
        password: form.password,
        display_name: form.display_name || undefined,
        is_super_admin: form.is_super_admin,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateUser = useMutation({
    mutationFn: () =>
      api.updateAdminUser(token!, editing!.id, {
        username: form.username,
        email: form.email,
        password: form.password || undefined,
        display_name: form.display_name,
        is_super_admin: form.is_super_admin,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditing(null)
      setForm(EMPTY_FORM)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteUser = useMutation({
    mutationFn: (userId: string) => api.deleteAdminUser(token!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const approveUser = useMutation({
    mutationFn: (userId: string) => api.approveAdminUser(token!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-system'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const rejectUser = useMutation({
    mutationFn: (userId: string) => api.rejectAdminUser(token!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-system'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setError(null)
  }

  function openEdit(target: AdminUser) {
    setShowForm(false)
    setEditing(target)
    setForm({
      username: target.username,
      email: target.email,
      password: '',
      display_name: target.display_name ?? '',
      is_super_admin: target.is_super_admin,
    })
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (editing) updateUser.mutate()
    else createUser.mutate()
  }

  const formOpen = showForm || editing
  const filters: { id: UserFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ]

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Users' },
        ]}
      />
      <PageHeader
        title="Users"
        subtitle="Create accounts, approve self-registrations, and manage platform access."
        action={
          <PrimaryButton type="button" onClick={openCreate}>
            <Plus size={14} />
            New user
          </PrimaryButton>
        }
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      {formOpen && (
        <div className="app-panel mb-4 max-w-xl">
          <div className="app-panel-header">{editing ? 'Edit user' : 'Create user'}</div>
          <form onSubmit={onSubmit} className="app-panel-body space-y-4">
            <label className="block text-sm font-semibold text-text">
              Username
              <input
                className={`${fieldClass} mt-1.5 font-mono`}
                value={form.username}
                onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))}
                required
              />
            </label>
            <label className="block text-sm font-semibold text-text">
              Email
              <input
                type="email"
                className={`${fieldClass} mt-1.5`}
                value={form.email}
                onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                required
              />
            </label>
            <label className="block text-sm font-semibold text-text">
              {editing ? 'New password (optional)' : 'Password'}
              <input
                type="password"
                className={`${fieldClass} mt-1.5`}
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                required={!editing}
                minLength={8}
              />
            </label>
            <label className="block text-sm font-semibold text-text">
              Display name (optional)
              <input
                className={`${fieldClass} mt-1.5`}
                value={form.display_name}
                onChange={(e) => setForm((current) => ({ ...current, display_name: e.target.value }))}
              />
            </label>
            <Checkbox
              row
              label="Super admin"
              checked={form.is_super_admin}
              onChange={(e) =>
                setForm((current) => ({ ...current, is_super_admin: e.target.checked }))
              }
            />
            <div className="flex gap-2">
              <PrimaryButton
                type="submit"
                disabled={createUser.isPending || updateUser.isPending}
              >
                {editing
                  ? updateUser.isPending
                    ? 'Saving…'
                    : 'Save changes'
                  : createUser.isPending
                    ? 'Creating…'
                    : 'Create user'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={closeForm}>
                Cancel
              </SecondaryButton>
            </div>
          </form>
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header flex flex-wrap items-center justify-between gap-3">
          <span>Users</span>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-naturals-n4 overflow-hidden">
              {filters.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === entry.id
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface text-text-secondary hover:bg-hover'
                  }`}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <span className="font-normal text-text-secondary">{total}</span>
          </div>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-text-secondary text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading users…
          </div>
        )}

        {!isLoading && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Auth</th>
                <th>Created</th>
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
                  <td>
                    {entry.is_super_admin ? (
                      <StatusBadge variant="violet">Super admin</StatusBadge>
                    ) : (
                      <StatusBadge variant="gray">User</StatusBadge>
                    )}
                  </td>
                  <td>{approvalBadge(entry.approval_status)}</td>
                  <td className="text-sm text-text-secondary">
                    {entry.has_password ? 'Password' : 'SSO / external'}
                  </td>
                  <td className="text-sm text-text-secondary">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {entry.approval_status === 'pending' && (
                        <>
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
                        </>
                      )}
                      {entry.approval_status === 'rejected' && (
                        <button
                          type="button"
                          className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-dashboard-success disabled:opacity-40"
                          title="Approve user"
                          disabled={approveUser.isPending}
                          onClick={() => approveUser.mutate(entry.id)}
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-text"
                        title="Edit user"
                        onClick={() => openEdit(entry)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-dashboard-danger disabled:opacity-40"
                        title="Delete user"
                        disabled={entry.id === currentUser?.id}
                        onClick={() => {
                          if (window.confirm(`Delete @${entry.username}?`)) {
                            deleteUser.mutate(entry.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
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
