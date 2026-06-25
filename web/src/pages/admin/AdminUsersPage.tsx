import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { AdminUser } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, PageHeader, PrimaryButton, SecondaryButton } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

const EMPTY_FORM = {
  username: '',
  email: '',
  password: '',
  display_name: '',
  is_super_admin: false,
}

export function AdminUsersPage() {
  const { token, user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.listAdminUsers(token!),
    enabled: Boolean(token),
  })

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
        subtitle="Create and manage platform accounts."
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
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={form.is_super_admin}
                onChange={(e) =>
                  setForm((current) => ({ ...current, is_super_admin: e.target.checked }))
                }
              />
              Super admin
            </label>
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
        <div className="app-panel-header flex items-center justify-between">
          <span>All users</span>
          <span className="font-normal text-text-secondary">{users.length}</span>
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
                <th>Auth</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((entry) => (
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
                  <td className="text-sm text-text-secondary">
                    {entry.has_password ? 'Password' : 'SSO / external'}
                  </td>
                  <td className="text-sm text-text-secondary">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
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
      </div>
    </>
  )
}
