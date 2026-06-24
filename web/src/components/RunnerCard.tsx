import { Check, Copy, Cpu, HardDrive, MemoryStick, Network, RefreshCw, Server, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Runner } from '../api/types'
import { StatusBadge } from './StatusBadge'
import { PrimaryButton, SecondaryButton } from './ui'

function runnerStatusVariant(status: Runner['status']) {
  if (status === 'online') return 'green' as const
  if (status === 'busy') return 'yellow' as const
  return 'gray' as const
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  const delta = Date.now() - date.getTime()
  if (delta < 60_000) return 'Just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return date.toLocaleString()
}

function formatMb(mb: number | null) {
  if (mb === null) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function formatDisk(free: number | null, total: number | null) {
  if (free === null || total === null) return '—'
  return `${formatMb(free)} free / ${formatMb(total)}`
}

function formatVersion(version: string | null) {
  if (!version) return '—'
  return version.startsWith('v') ? version : `v${version}`
}

function MetricItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="runner-metric">
      <div className="runner-metric-icon">{icon}</div>
      <div className="min-w-0">
        <div className="runner-metric-label">{label}</div>
        <div className="runner-metric-value">{value}</div>
      </div>
    </div>
  )
}

export function RunnerCard({
  runner,
  onRotate,
  onDelete,
  rotating,
}: {
  runner: Runner
  onRotate: () => void
  onDelete: () => void
  rotating: boolean
}) {
  const memory =
    runner.memory_used_mb !== null && runner.memory_total_mb !== null
      ? `${formatMb(runner.memory_used_mb)} / ${formatMb(runner.memory_total_mb)}`
      : '—'

  return (
    <li className="runner-card">
      <div className="runner-card-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Server size={15} className="text-primary shrink-0" />
            <span className="text-sm font-semibold text-text truncate">{runner.name}</span>
            <StatusBadge variant={runnerStatusVariant(runner.status)}>{runner.status}</StatusBadge>
          </div>
          <div className="text-xs text-text-secondary mt-1 font-mono">
            Labels: {runner.labels.join(', ') || 'self-hosted'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRotate}
            disabled={rotating}
            className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:bg-hover hover:text-primary"
            title="Rotate token"
            data-no-global-button-hover="true"
          >
            <RefreshCw size={14} className={rotating ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-2 rounded-md border border-naturals-n4 text-text-secondary hover:text-dashboard-danger hover:border-red-r1/30"
            title="Delete runner"
            data-no-global-button-hover="true"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="runner-metrics-grid">
        <MetricItem
          icon={<Network size={13} />}
          label="IP"
          value={runner.host_ip ?? '—'}
        />
        <MetricItem
          icon={<Server size={13} />}
          label="Host"
          value={runner.host_name ?? '—'}
        />
        <MetricItem
          icon={<Cpu size={13} />}
          label="CPU"
          value={runner.cpu_cores !== null ? `${runner.cpu_cores} cores` : '—'}
        />
        <MetricItem
          icon={<MemoryStick size={13} />}
          label="Memory"
          value={memory}
        />
        <MetricItem
          icon={<HardDrive size={13} />}
          label="Disk"
          value={formatDisk(runner.disk_free_mb, runner.disk_total_mb)}
        />
        <MetricItem
          icon={<Server size={13} />}
          label="Version"
          value={formatVersion(runner.version)}
        />
      </div>

      <div className="runner-card-footer text-xs text-text-secondary font-mono">
        <span>
          Last run{' '}
          <strong className="text-text">
            {runner.last_job_name
              ? `${runner.last_job_name} (${runner.last_job_status ?? 'unknown'})`
              : '—'}
          </strong>
          {runner.last_job_at ? ` · ${formatRelativeTime(runner.last_job_at)}` : ''}
        </span>
        <span>Seen {formatRelativeTime(runner.last_seen_at)}</span>
      </div>
    </li>
  )
}

export function TokenModal({
  title,
  token,
  onClose,
}: {
  title: string
  token: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-naturals-n4 bg-surface shadow-lg">
        <div className="border-b border-naturals-n4 px-5 py-4">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Copy this token now — it will not be shown again.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-md border border-naturals-n4 bg-bg px-3 py-2 font-mono text-sm text-text break-all">
            {token}
          </div>
          <p className="text-sm text-text-secondary">
            Set on the runner host in{' '}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">/etc/pertisk-runner/pertisk-runner.conf</code>:
          </p>
          <pre className="overflow-x-auto rounded-md border border-naturals-n4 bg-bg p-3 text-xs text-text">
{`PERTISK_RUNNER_TOKEN=${token}
PERTISK_API_URL=https://your-gits-host:8080
# Optional — omit on remote runners; workspace is fetched from the API
PERTISK_REPOS_ROOT=/var/lib/pertisk-gits/repos`}
          </pre>
          <p className="text-sm text-text-secondary">
            Then restart:{' '}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">sudo systemctl restart pertisk-runner</code>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-naturals-n4 px-5 py-4">
          <SecondaryButton type="button" onClick={copyToken}>
            {copied ? (
              <>
                <Check size={14} />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy token
              </>
            )}
          </SecondaryButton>
          <PrimaryButton type="button" onClick={onClose}>
            Done
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
