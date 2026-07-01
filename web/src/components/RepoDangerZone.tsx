import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRightLeft, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { groupUrlPath } from '../lib/groupPath'
import { ConfirmModal } from './ConfirmModal'
import { TypeToConfirmField } from './TypeToConfirmField'
import { SettingsPanel } from './settings/SettingsPanel'
import { PrimaryButton, SecondaryButton, Select } from './ui'

interface RepoDangerZoneProps {
  token: string
  orgSlug: string
  repoSlug: string
}

export function RepoDangerZone({ token, orgSlug, repoSlug }: RepoDangerZoneProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [targetOrgPath, setTargetOrgPath] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [confirmSlug, setConfirmSlug] = useState('')

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token),
    enabled: Boolean(token),
  })

  const transferTargets = useMemo(
    () =>
      groups
        .filter((group) => groupUrlPath(group) !== orgSlug)
        .sort((a, b) => groupUrlPath(a).localeCompare(groupUrlPath(b))),
    [groups, orgSlug],
  )

  const selectedTarget = transferTargets.find((group) => groupUrlPath(group) === targetOrgPath)

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteRepository(token, orgSlug, repoSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories', orgSlug] })
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      navigate(`/groups/${orgSlug}`, { replace: true })
    },
  })

  const transferMutation = useMutation({
    mutationFn: () => api.transferRepository(token, orgSlug, repoSlug, targetOrgPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
      navigate(`/groups/${targetOrgPath}/projects/${repoSlug}`, { replace: true })
    },
  })

  const slugOk = confirmSlug === repoSlug

  return (
    <>
      <SettingsPanel
        title="Danger zone"
        description="Move this repository to another group or delete it permanently."
        icon={AlertTriangle}
        className="border-dashboard-danger/30"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-naturals-n4 px-4 py-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-text">Transfer repository</p>
              <p className="text-xs text-text-secondary mt-0.5">
                Move <span className="font-mono">{repoSlug}</span> to a different group. Git history
                and settings move with it.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Select
                label="Target group"
                inline
                className="min-w-[14rem]"
                value={targetOrgPath}
                onChange={(e) => setTargetOrgPath(e.target.value)}
                aria-label="Target group"
              >
                <option value="">Select a group…</option>
                {transferTargets.map((group) => {
                  const path = groupUrlPath(group)
                  return (
                    <option key={group.id} value={path}>
                      {path}
                    </option>
                  )
                })}
              </Select>
              <PrimaryButton
                type="button"
                disabled={!targetOrgPath || transferMutation.isPending}
                onClick={() => setTransferOpen(true)}
              >
                <ArrowRightLeft size={14} />
                Transfer
              </PrimaryButton>
            </div>
            {transferMutation.error && (
              <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                {(transferMutation.error as Error).message}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashboard-danger/25 bg-dashboard-danger-bg/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Delete this repository</p>
              <p className="text-xs text-text-secondary mt-0.5">
                Permanently remove <span className="font-mono">{orgSlug}/{repoSlug}</span>, including
                issues, pipelines, and Git data.
              </p>
            </div>
            <SecondaryButton
              type="button"
              className="!border-dashboard-danger/40 !text-dashboard-danger hover:!bg-dashboard-danger-bg"
              onClick={() => {
                setConfirmSlug('')
                setDeleteOpen(true)
              }}
            >
              <Trash2 size={14} />
              Delete repository
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
        title="Delete repository?"
        description={
          <div className="space-y-3 text-sm">
            <p>
              This will permanently delete{' '}
              <strong className="font-mono">
                {orgSlug}/{repoSlug}
              </strong>
              .
            </p>
            <TypeToConfirmField
              confirmText={repoSlug}
              value={confirmSlug}
              onChange={setConfirmSlug}
            />
          </div>
        }
        confirmLabel="Delete repository"
        variant="danger"
        loading={deleteMutation.isPending}
        confirmDisabled={!slugOk}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteOpen(false)
        }}
      />

      <ConfirmModal
        open={transferOpen}
        title="Transfer repository?"
        description={
          <p className="text-sm">
            Move <strong className="font-mono">{repoSlug}</strong> from{' '}
            <span className="font-mono">{orgSlug}</span> to{' '}
            <span className="font-mono">{selectedTarget ? groupUrlPath(selectedTarget) : targetOrgPath}</span>?
          </p>
        }
        confirmLabel="Transfer repository"
        loading={transferMutation.isPending}
        onConfirm={() => transferMutation.mutate()}
        onCancel={() => {
          if (!transferMutation.isPending) setTransferOpen(false)
        }}
      />
    </>
  )
}
