import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Organization } from '../api/types'
import { groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { ConfirmModal } from './ConfirmModal'
import { TypeToConfirmField } from './TypeToConfirmField'
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
  const [confirmPath, setConfirmPath] = useState('')

  const groupPath = groupUrlPath(group)

  const { data: repos = [] } = useQuery({
    queryKey: ['repositories', orgPath],
    queryFn: () => api.listRepositories(token, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const subgroupCount = useMemo(
    () => allGroups.filter((item) => item.parent_id === group.id).length,
    [allGroups, group.id],
  )
  const nestedSubgroupCount = useMemo(
    () =>
      allGroups.filter(
        (item) =>
          item.id !== group.id &&
          (item.full_path === group.full_path ||
            item.full_path.startsWith(`${group.full_path}/`)),
      ).length,
    [allGroups, group.full_path, group.id],
  )
  const repoCount = repos.length
  const hasContents = repoCount > 0 || subgroupCount > 0
  const pathOk = confirmPath === groupPath

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteOrganization(token, orgPath, hasContents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      const parentPath = group.parent_id
        ? allGroups.find((item) => item.id === group.parent_id)
        : null
      navigate(parentPath ? groupBaseUrl(parentPath) : '/groups', { replace: true })
    },
  })

  const contentSummary = useMemo(() => {
    const parts: string[] = []
    if (repoCount > 0) {
      parts.push(`${repoCount} repositor${repoCount === 1 ? 'y' : 'ies'}`)
    }
    if (nestedSubgroupCount > 0) {
      parts.push(`${nestedSubgroupCount} subgroup${nestedSubgroupCount === 1 ? '' : 's'}`)
    }
    return parts.join(' and ')
  }, [nestedSubgroupCount, repoCount])

  return (
    <>
      <SettingsPanel
        title="Danger zone"
        description="Irreversible actions for this group."
        icon={AlertTriangle}
        className="border-dashboard-danger/30"
      >
        <div className="space-y-4">
          {hasContents && (
            <p className="text-sm text-text-secondary">
              This group contains {contentSummary}. You can delete everything in one step — all
              repositories, subgroups, issues, pipelines, and Git data will be permanently removed.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashboard-danger/25 bg-dashboard-danger-bg/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">
                {hasContents ? 'Delete group and all contents' : 'Delete this group'}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                Permanently remove <span className="font-mono">{groupPath}</span>
                {hasContents ? ' and everything inside it' : ' and its settings'}. This cannot be
                undone.
              </p>
            </div>
            <SecondaryButton
              type="button"
              className="!border-dashboard-danger/40 !text-dashboard-danger hover:!bg-dashboard-danger-bg"
              onClick={() => {
                setConfirmPath('')
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
        title={hasContents ? 'Delete group and all contents?' : 'Delete group?'}
        description={
          <div className="space-y-3 text-sm">
            {hasContents ? (
              <p>
                This will permanently delete <strong className="font-mono">{groupPath}</strong>,
                including {contentSummary || 'all nested content'}. This cannot be undone.
              </p>
            ) : (
              <p>
                This will permanently delete <strong className="font-mono">{groupPath}</strong>.
              </p>
            )}
            <TypeToConfirmField
              confirmText={groupPath}
              value={confirmPath}
              onChange={setConfirmPath}
            />
          </div>
        }
        confirmLabel={hasContents ? 'Delete everything' : 'Delete group'}
        variant="danger"
        loading={deleteMutation.isPending}
        confirmDisabled={!pathOk}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteOpen(false)
        }}
      />
    </>
  )
}
