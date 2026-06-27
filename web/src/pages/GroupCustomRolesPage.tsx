import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Shield, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CustomRolePermissions, OrganizationCustomRole } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Checkbox, PrimaryButton, SecondaryButton, Select } from '../components/ui'

const EMPTY_PERMISSIONS: CustomRolePermissions = {
  manage_members: false,
  manage_settings: false,
  view_audit: false,
  manage_teams: false,
  manage_custom_roles: false,
  create_repositories: false,
  manage_org_secrets: false,
  default_repo_access: null,
}

function PermissionEditor({
  permissions,
  onChange,
}: {
  permissions: CustomRolePermissions
  onChange: (next: CustomRolePermissions) => void
}) {
  const toggles: { key: keyof CustomRolePermissions; label: string }[] = [
    { key: 'manage_members', label: 'Manage members' },
    { key: 'manage_settings', label: 'Manage group settings' },
    { key: 'view_audit', label: 'View audit log' },
    { key: 'manage_teams', label: 'Manage teams' },
    { key: 'manage_custom_roles', label: 'Manage custom roles' },
    { key: 'create_repositories', label: 'Create repositories' },
    { key: 'manage_org_secrets', label: 'Manage group secrets' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {toggles.map(({ key, label }) => (
          <Checkbox
            key={key}
            id={`perm-${key}`}
            label={label}
            checked={Boolean(permissions[key])}
            onChange={(e) => onChange({ ...permissions, [key]: e.target.checked })}
          />
        ))}
      </div>
      <Select
        id="default-repo-access"
        label="Default repository access"
        hint="Applied to all repositories when no direct or team grant exists."
        value={permissions.default_repo_access ?? ''}
        onChange={(e) =>
          onChange({
            ...permissions,
            default_repo_access: e.target.value
              ? (e.target.value as CustomRolePermissions['default_repo_access'])
              : null,
          })
        }
      >
        <option value="">Inherit group member default (read)</option>
        <option value="read">Read</option>
        <option value="write">Write</option>
        <option value="admin">Admin</option>
      </Select>
    </div>
  )
}

export function GroupCustomRolesPage() {
  const { slug = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissions, setPermissions] = useState<CustomRolePermissions>(EMPTY_PERMISSIONS)
  const [editing, setEditing] = useState<OrganizationCustomRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queryKey = ['custom-roles', slug]

  const { data: roles = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.listCustomRoles(token!, slug),
    enabled: Boolean(token && slug),
  })

  const createRole = useMutation({
    mutationFn: () =>
      api.createCustomRole(token!, slug, {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setName('')
      setDescription('')
      setPermissions(EMPTY_PERMISSIONS)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateRole = useMutation({
    mutationFn: () =>
      api.updateCustomRole(token!, slug, editing!.slug, {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEditing(null)
      setName('')
      setDescription('')
      setPermissions(EMPTY_PERMISSIONS)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteRole = useMutation({
    mutationFn: (roleSlug: string) => api.deleteCustomRole(token!, slug, roleSlug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  function startEdit(role: OrganizationCustomRole) {
    setEditing(role)
    setName(role.name)
    setDescription(role.description ?? '')
    setPermissions({ ...EMPTY_PERMISSIONS, ...role.permissions })
    setError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setName('')
    setDescription('')
    setPermissions(EMPTY_PERMISSIONS)
    setError(null)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (editing) {
      updateRole.mutate()
    } else {
      createRole.mutate()
    }
  }

  if (!token) return null

  return (
    <div className="space-y-5">
      <div className="app-repo-header">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text">Custom roles</h1>
          <p className="text-sm text-text-secondary">
            Define fine-grained permissions beyond owner, admin, and member. Assign roles on the
            Members page.
          </p>
        </div>
      </div>

      <div className="app-panel max-w-3xl">
        <div className="app-panel-header flex items-center gap-2">
          <Shield size={15} className="text-primary" />
          {editing ? `Edit ${editing.name}` : 'Create role'}
        </div>
        <form className="app-panel-body space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="role-name" className="text-sm font-medium text-text">
              Name
            </label>
            <input
              id="role-name"
              className="app-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="role-description" className="text-sm font-medium text-text">
              Description
            </label>
            <textarea
              id="role-description"
              className="app-field"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <PermissionEditor permissions={permissions} onChange={setPermissions} />
          {error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <PrimaryButton type="submit" disabled={createRole.isPending || updateRole.isPending}>
              {createRole.isPending || updateRole.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : editing ? (
                'Save changes'
              ) : (
                'Create role'
              )}
            </PrimaryButton>
            {editing && (
              <SecondaryButton type="button" onClick={cancelEdit}>
                Cancel
              </SecondaryButton>
            )}
          </div>
        </form>
      </div>

      <div className="app-panel">
        <div className="app-panel-header">Roles</div>
        <div className="app-panel-body">
          {isLoading ? (
            <p className="text-sm text-text-secondary">Loading roles…</p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-text-secondary">No custom roles yet.</p>
          ) : (
            <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
              {roles.map((role) => (
                <li key={role.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">{role.name}</div>
                    {role.description && (
                      <p className="text-sm text-text-secondary mt-1">{role.description}</p>
                    )}
                    <div className="text-xs font-mono text-muted mt-1">{role.slug}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SecondaryButton type="button" onClick={() => startEdit(role)}>
                      Edit
                    </SecondaryButton>
                    <button
                      type="button"
                      onClick={() => deleteRole.mutate(role.slug)}
                      className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger hover:border-red-r1/30"
                      title="Delete role"
                      data-no-global-button-hover="true"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
