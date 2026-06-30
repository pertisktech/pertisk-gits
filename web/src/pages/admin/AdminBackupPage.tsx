import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Download, HardDrive, Loader2, Package, Trash2, Upload } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { BackupComponentId, BackupJob } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { DeleteBackupConfirm, RestoreBackupConfirm } from '../../components/ConfirmModal'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, Checkbox, PageHeader, PrimaryButton, SecondaryButton } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'
import { formatBytes } from '../../lib/formatBytes'

const COMPONENT_OPTIONS: {
  id: BackupComponentId
  label: string
  description: string
  icon: typeof Database
}[] = [
  {
    id: 'db',
    label: 'Database',
    description: 'PostgreSQL dump (users, repos, registry metadata, CI data)',
    icon: Database,
  },
  {
    id: 'registry',
    label: 'Container registry',
    description: 'Registry blob files (local disk or S3-backed blobs)',
    icon: Package,
  },
  {
    id: 'artifacts',
    label: 'CI artifacts',
    description: 'Pipeline job artifact files on disk',
    icon: HardDrive,
  },
]

function statusBadge(status: BackupJob['status']) {
  switch (status) {
    case 'completed':
      return <StatusBadge variant="green">Completed</StatusBadge>
    case 'failed':
      return <StatusBadge variant="red">Failed</StatusBadge>
    case 'running':
      return <StatusBadge variant="yellow">Running</StatusBadge>
    default:
      return <StatusBadge variant="gray">Pending</StatusBadge>
  }
}

function componentLabels(components: BackupComponentId[]) {
  return components
    .map((id) => COMPONENT_OPTIONS.find((option) => option.id === id)?.label ?? id)
    .join(', ')
}

export function AdminBackupPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<BackupComponentId[]>(['db', 'registry', 'artifacts'])
  const [restoreSelected, setRestoreSelected] = useState<BackupComponentId[]>([
    'db',
    'registry',
    'artifacts',
  ])
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pollingId, setPollingId] = useState<string | null>(null)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<BackupJob | null>(null)

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-backup-overview'],
    queryFn: () => api.getBackupOverview(token!),
    enabled: Boolean(token),
  })

  const { data: backups = [], isLoading: backupsLoading } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: () => api.listBackups(token!),
    enabled: Boolean(token),
    refetchInterval: pollingId ? 2000 : false,
  })

  useEffect(() => {
    if (!pollingId) return
    const job = backups.find((entry) => entry.id === pollingId)
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      setPollingId(null)
    }
  }, [backups, pollingId])

  const createBackup = useMutation({
    mutationFn: () => api.createBackup(token!, selected),
    onSuccess: (job) => {
      setPollingId(job.id)
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteBackup = useMutation({
    mutationFn: (backupId: string) => api.deleteBackup(token!, backupId),
    onSuccess: () => {
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const restoreBackup = useMutation({
    mutationFn: () =>
      api.restoreBackup(token!, restoreFile!, restoreSelected, restoreConfirm),
    onSuccess: () => {
      setShowRestoreConfirm(false)
      setRestoreFile(null)
      setRestoreConfirm('')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function onDownload(backupId: string) {
    api.downloadBackup(token!, backupId)
    setError(null)
  }

  function toggleComponent(
    id: BackupComponentId,
    checked: boolean,
    mode: 'backup' | 'restore',
  ) {
    const setter = mode === 'backup' ? setSelected : setRestoreSelected
    setter((current) =>
      checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id),
    )
  }

  function onCreateBackup(event: FormEvent) {
    event.preventDefault()
    if (selected.length === 0) {
      setError('Select at least one component to back up')
      return
    }
    createBackup.mutate()
  }

  function onRestore(event: FormEvent) {
    event.preventDefault()
    if (!restoreFile) {
      setError('Choose a backup archive to restore')
      return
    }
    if (restoreSelected.length === 0) {
      setError('Select at least one component to restore')
      return
    }
    if (restoreConfirm !== 'RESTORE') {
      setError('Type RESTORE to confirm')
      return
    }
    setShowRestoreConfirm(true)
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Backups' },
        ]}
      />
      <PageHeader
        title="Backups & restore"
        subtitle="Create archives of the database, container registry, and CI artifacts. Restore selected components from a backup file."
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      {overviewLoading && (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-4">
          <Loader2 size={16} className="animate-spin" />
          Loading storage overview…
        </div>
      )}

      {overview && (
        <div className="mb-4 max-w-3xl">
        <InfoPanel title="Storage overview">
          <InfoRow label="Backups directory" value={<code>{overview.backups_root}</code>} />
          <InfoRow label="Registry storage" value={overview.registry_storage} />
          {overview.components.map((component) => (
            <InfoRow
              key={component.id}
              label={component.label}
              value={
                <>
                  {formatBytes(component.size_bytes)} · <code>{component.path}</code>
                </>
              }
            />
          ))}
        </InfoPanel>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2 mb-4">
        <div className="app-panel">
          <div className="app-panel-header">Create backup</div>
          <form onSubmit={onCreateBackup} className="app-panel-body space-y-4">
            <p className="text-sm text-text-secondary">
              Select components to include in a compressed archive. Requires{' '}
              <code>pg_dump</code> and <code>pg_restore</code> on the server
              (package <code>postgresql-client</code> on Debian/Alpine,{' '}
              <code>postgresql</code> on RHEL/AlmaLinux).
            </p>
            <div className="space-y-3">
              {COMPONENT_OPTIONS.map(({ id, label, description, icon: Icon }) => (
                <Checkbox
                  key={id}
                  className="items-start gap-3 p-3 rounded-lg border border-naturals-n4 hover:bg-hover w-full"
                  checked={selected.includes(id)}
                  onChange={(e) => toggleComponent(id, e.target.checked, 'backup')}
                  label={
                    <span className="flex items-start gap-3 min-w-0">
                      <Icon size={16} className="text-primary shrink-0 mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-text">{label}</span>
                        <span className="block text-xs text-text-secondary mt-0.5">{description}</span>
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
            <PrimaryButton type="submit" disabled={createBackup.isPending || Boolean(pollingId)}>
              {createBackup.isPending || pollingId ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating backup…
                </>
              ) : (
                'Create backup'
              )}
            </PrimaryButton>
          </form>
        </div>

        <div className="app-panel">
          <div className="app-panel-header">Restore backup</div>
          <form onSubmit={onRestore} className="app-panel-body space-y-4">
            <p className="text-sm text-text-secondary">
              Upload a backup archive created on this platform. Restore overwrites the selected
              components. Requires <code>pg_restore</code> (same PostgreSQL client package as
              backup).
            </p>
            <label className="block text-sm font-semibold text-text">
              Backup archive (.tar.gz)
              <input
                type="file"
                accept=".tar.gz,.tgz,application/gzip"
                className="block mt-1.5 w-full text-sm"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="space-y-2">
              {COMPONENT_OPTIONS.map(({ id, label }) => (
                <Checkbox
                  key={id}
                  row
                  label={label}
                  checked={restoreSelected.includes(id)}
                  onChange={(e) => toggleComponent(id, e.target.checked, 'restore')}
                />
              ))}
            </div>
            <label className="block text-sm font-semibold text-text">
              Type RESTORE to confirm
              <input
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm"
                value={restoreConfirm}
                onChange={(e) => setRestoreConfirm(e.target.value)}
                placeholder="RESTORE"
              />
            </label>
            <PrimaryButton
              type="submit"
              disabled={restoreBackup.isPending || !restoreFile}
            >
              {restoreBackup.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Restoring…
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Restore selected
                </>
              )}
            </PrimaryButton>
          </form>
        </div>
      </div>

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>Backup history</span>
          <SecondaryButton
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-backups'] })}
          >
            Refresh
          </SecondaryButton>
        </div>

        {backupsLoading && (
          <div className="p-8 text-center text-text-secondary text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading backups…
          </div>
        )}

        {!backupsLoading && backups.length === 0 && (
          <div className="p-8 text-center text-text-secondary text-sm">No backups yet.</div>
        )}

        {!backupsLoading && backups.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Components</th>
                <th>Status</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {backups.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-sm text-text-secondary">
                    {formatDateTime(entry.created_at)}
                    {entry.error && (
                      <div className="text-xs text-dashboard-danger mt-1">{entry.error}</div>
                    )}
                  </td>
                  <td className="text-sm text-text">{componentLabels(entry.components)}</td>
                  <td>{statusBadge(entry.status)}</td>
                  <td className="text-sm text-text-secondary">
                    {entry.archive_size_bytes != null
                      ? formatBytes(entry.archive_size_bytes)
                      : '—'}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {entry.status === 'completed' && (
                        <button
                          type="button"
                          className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-text"
                          title="Download backup"
                          onClick={() => onDownload(entry.id)}
                        >
                          <Download size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-hover text-text-secondary hover:text-dashboard-danger"
                        title="Delete backup"
                        onClick={() => setPendingDelete(entry)}
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

      {showRestoreConfirm && restoreFile && (
        <RestoreBackupConfirm
          fileName={restoreFile.name}
          components={componentLabels(restoreSelected)}
          loading={restoreBackup.isPending}
          onConfirm={() => restoreBackup.mutate()}
          onCancel={() => {
            if (!restoreBackup.isPending) setShowRestoreConfirm(false)
          }}
        />
      )}

      {pendingDelete && (
        <DeleteBackupConfirm
          createdAt={formatDateTime(pendingDelete.created_at)}
          components={componentLabels(pendingDelete.components)}
          loading={deleteBackup.isPending}
          onConfirm={() => deleteBackup.mutate(pendingDelete.id)}
          onCancel={() => {
            if (!deleteBackup.isPending) setPendingDelete(null)
          }}
        />
      )}
    </>
  )
}
