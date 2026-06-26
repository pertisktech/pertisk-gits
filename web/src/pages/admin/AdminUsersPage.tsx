import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { AdminUser } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { Card } from '../../components/Card'
import {
  Alert,
  Breadcrumbs,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui'
import { CheckboxField, FieldLabel, Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/collaboration'

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
    <div className="space-y-6">
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
          <PrimaryButton type="button" onClick={openCreate} startIcon={<Plus size={16} />}>
            New user
          </PrimaryButton>
        }
      />

      {error && <Alert>{error}</Alert>}

      {formOpen && (
        <Card title={editing ? 'Edit user' : 'Create user'} className="max-w-xl">
          <form onSubmit={onSubmit} className="space-y-4">
            <FieldLabel label="Username">
              <Input
                className="font-mono"
                value={form.username}
                onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))}
                required
              />
            </FieldLabel>
            <FieldLabel label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
                required
              />
            </FieldLabel>
            <FieldLabel label={editing ? 'New password (optional)' : 'Password'}>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                required={!editing}
                minLength={8}
              />
            </FieldLabel>
            <FieldLabel label="Display name (optional)">
              <Input
                value={form.display_name}
                onChange={(e) => setForm((current) => ({ ...current, display_name: e.target.value }))}
              />
            </FieldLabel>
            <CheckboxField
              label="Super admin"
              checked={form.is_super_admin}
              onChange={(checked) => setForm((current) => ({ ...current, is_super_admin: checked }))}
            />
            <div className="flex gap-2">
              <PrimaryButton type="submit" disabled={createUser.isPending || updateUser.isPending}>
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
        </Card>
      )}

      <div className="shell-card">
        <div className="shell-card-header">
          <span>All users</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{users.length}</span>
        </div>

        {isLoading && (
          <div className="shell-card-body flex items-center justify-center gap-2 py-12 text-theme-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            Loading users…
          </div>
        )}

        {!isLoading && (
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
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
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        @{entry.username}
                      </div>
                      <div className="text-theme-xs text-gray-500 dark:text-gray-400">{entry.email}</div>
                      {entry.display_name && (
                        <div className="mt-0.5 text-theme-xs text-gray-400">{entry.display_name}</div>
                      )}
                    </td>
                    <td>
                      {entry.is_super_admin ? (
                        <StatusBadge variant="violet">Super admin</StatusBadge>
                      ) : (
                        <StatusBadge variant="gray">User</StatusBadge>
                      )}
                    </td>
                    <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {entry.has_password ? 'Password' : 'SSO / external'}
                    </td>
                    <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {formatDateTime(entry.created_at)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white/90"
                          title="Edit user"
                          onClick={() => openEdit(entry)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-500 disabled:opacity-40 dark:hover:bg-error-500/10"
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
          </div>
        )}
      </div>
    </div>
  )
}
