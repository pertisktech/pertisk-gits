import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Organization } from '../api/types'
import { groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { ConfirmModal } from './ConfirmModal'
import { SettingsPanel } from './settings/SettingsPanel'
import { SecondaryButton } from './ui'

interface GroupDangerZoneProps {
  token: string
  orgPath: string
  group: Organization
  allGroups: Organization[]
}

export function GroupDangerZone({ token, orgPath, group, allGroups }: GroupDangerZoneProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmSlug, setConfirmSlug] = useState('')

  const { data: repos = [] } = useQuery({
    queryKey: ['repositories', orgPath],
    queryFn: () => api.listRepositories(token, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const subgroupCount = useMemo(
    () => allGroups.filter((item) => item.parent_id === group.id).length,
    [allGroups, group.id],
  )
  const repoCount = repos.length
  const canDelete = subgroupCount === 0 && repoCount === 0
  const slugOk = confirmSlug === group.slug

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteOrganization(token, orgPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      const parentPath = group.parent_id
        ? allGroups.find((item) => item.id === group.parent_id)
        : null
      navigate(parentPath ? groupBaseUrl(parentPath) : '/groups', { replace: true })
    },
  })

  const blockers: string[] = []
  if (subgroupCount > 0) {
    blockers.push(`${subgroupCount} subgroup${subgroupCount === 1 ? '' : 's'}`)
  }
  if (repoCount > 0) {
    blockers.push(`${repoCount} repositor${repoCount === 1 ? 'y' : 'ies'}`)
  }

  return (
    <>
      <SettingsPanel
        title="Danger zone"
        description="Irreversible actions for this group."
        icon={AlertTriangle}
        className="border-dashboard-danger/30"
      >
        <div className="space-y-4">
          {!canDelete && (
            <p className="text-sm text-text-secondary">
              This group cannot be deleted while it still contains{' '}
              {blockers.join(' and ')}. Move or delete them first.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashboard-danger/25 bg-dashboard-danger-bg/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Delete this group</p>
              <p className="text-xs text-text-secondary mt-0.5">
                Permanently remove <span className="font-mono">{groupUrlPath(group)}</span> and its
                settings. This cannot be undone.
              </p>
            </div>
            <SecondaryButton
              type="button"
              className="!border-dashboard-danger/40 !text-dashboard-danger hover:!bg-dashboard-danger-bg"
              disabled={!canDelete}
              onClick={() => {
                setConfirmSlug('')
                setDeleteOpen(true)
              }}
            >
              <Trash2 size={14} />
              Delete group
            </SecondaryButton>
          </div>

          {deleteMutation.error && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {(deleteMutation.error as Error).message}
            </div>
          )}
        </div>
      </SettingsPanel>

      <ConfirmModal
        open={deleteOpen}
        title="Delete group?"
        description={
          <div className="space-y-3 text-sm">
            <p>
              This will permanently delete <strong className="font-mono">{groupUrlPath(group)}</strong>.
            </p>
            <label className="block">
              <span className="text-text-secondary">
                Type <span className="font-mono text-text">{group.slug}</span> to confirm
              </span>
              <input
                className="app-field mt-1.5 font-mono"
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        }
        confirmLabel="Delete group"
        variant="danger"
        loading={deleteMutation.isPending}
        confirmDisabled={!slugOk}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteOpen(false)
        }}
      />
    </>
  )
}
