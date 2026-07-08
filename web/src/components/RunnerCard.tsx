import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Cpu, HardDrive, MemoryStick, Network, RefreshCw, Server, Trash2, Boxes } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Runner, RunnerInstance, RunnerK8sPod } from '../api/types'
import { fetchRunnerApiUrl, formatRunnerConf } from '../lib/runnerConfig'
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

function instanceStatusVariant(status: RunnerInstance['status']) {
  if (status === 'online') return 'green' as const
  return 'gray' as const
}

function k8sPhaseVariant(phase: string) {
  if (phase === 'running' || phase === 'pending') return 'yellow' as const
  if (phase === 'succeeded') return 'green' as const
  return 'gray' as const
}

function looksLikeK8sPodName(name: string): boolean {
  const parts = name.split('-')
  if (parts.length < 3) return false
  const hash = parts.at(-2)
  if (!hash) return false
  return hash.length >= 8 && /^[a-z0-9]+$/i.test(hash)
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

function RunnerInstancesSection({ instances }: { instances: RunnerInstance[] }) {
  if (instances.length === 0) return null
  const allK8sManagers = instances.every((instance) => looksLikeK8sPodName(instance.instance_id))
  const sectionTitle = allK8sManagers ? 'Manager pods' : 'Host instances'

  return (
    <div className="runner-pods-section">
      <div className="runner-pods-title">
        <Boxes size={13} />
        <span>{sectionTitle} ({instances.length})</span>
      </div>
      <ul className="runner-pods-list">
        {instances.map((instance) => {
          const memory =
            instance.memory_used_mb !== null && instance.memory_total_mb !== null
              ? `${formatMb(instance.memory_used_mb)} / ${formatMb(instance.memory_total_mb)}`
              : '—'
          return (
            <li key={instance.instance_id} className="runner-pod-row">
              <div className="runner-pod-row-main">
                <span className="runner-pod-name">{instance.instance_id}</span>
                <StatusBadge variant={instanceStatusVariant(instance.status)}>
                  {instance.status}
                </StatusBadge>
              </div>
              <div className="runner-pod-row-meta">
                <span>{instance.host_ip ?? '—'}</span>
                <span>{instance.cpu_cores !== null ? `${instance.cpu_cores} CPU` : '—'}</span>
                <span>{memory}</span>
                <span>Seen {formatRelativeTime(instance.last_seen_at)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RunnerK8sPodsSection({ pods }: { pods: RunnerK8sPod[] }) {
  if (pods.length === 0) return null

  return (
    <div className="runner-pods-section">
      <div className="runner-pods-title">
        <Server size={13} />
        <span>Job pods ({pods.length})</span>
      </div>
      <ul className="runner-pods-list">
        {pods.map((pod) => (
          <li key={pod.job_run_id} className="runner-pod-row">
            <div className="runner-pod-row-main">
              <span className="runner-pod-name">
                {pod.k8s_pod_name ?? pod.k8s_job_name}
              </span>
              <StatusBadge variant={k8sPhaseVariant(pod.phase)}>{pod.phase}</StatusBadge>
            </div>
            <div className="runner-pod-row-meta">
              <span>{pod.job_name}</span>
              <span>{pod.k8s_namespace}</span>
              <span>Started {formatRelativeTime(pod.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
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

  const instances = runner.instances ?? []
  const visibleInstances = instances.filter((instance) => {
    const sameAsHost = runner.host_name && instance.instance_id === runner.host_name
    if (sameAsHost && !looksLikeK8sPodName(instance.instance_id)) {
      return false
    }
    return true
  })
  const k8sPods = runner.k8s_pods ?? []
  const showPodSections = visibleInstances.length > 0 || k8sPods.length > 0

  return (
    <li className="runner-card">
      <div className="runner-card-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Server size={15} className="text-primary shrink-0" />
            <span className="text-sm font-semibold text-text truncate">{runner.name}</span>
            <StatusBadge variant={runnerStatusVariant(runner.status)}>{runner.status}</StatusBadge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {runner.labels.length > 0 ? (
              runner.labels.map((label) => (
                <span key={label} className="runner-label-badge">
                  {label}
                </span>
              ))
            ) : (
              <span className="text-xs text-text-secondary">No labels</span>
            )}
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

      {showPodSections ? (
        <>
          <RunnerInstancesSection instances={visibleInstances} />
          <RunnerK8sPodsSection pods={k8sPods} />
        </>
      ) : null}

      <div className="runner-card-footer text-xs text-text-secondary font-mono">
        <span>
          {runner.status === 'busy' && runner.current_job_name ? (
            <>
              Running{' '}
              <strong className="text-text">{runner.current_job_name}</strong>
            </>
          ) : (
            <>
              Last run{' '}
              <strong className="text-text">
                {runner.last_job_name
                  ? `${runner.last_job_name} (${runner.last_job_status ?? 'unknown'})`
                  : '—'}
              </strong>
              {runner.last_job_at ? ` · ${formatRelativeTime(runner.last_job_at)}` : ''}
            </>
          )}
        </span>
        <span>Seen {formatRelativeTime(runner.last_seen_at)}</span>
      </div>
    </li>
  )
}

export function TokenModal({
  title,
  token,
  apiUrl: apiUrlProp,
  onClose,
}: {
  title: string
  token: string
  apiUrl?: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'token' | 'config' | null>(null)

  const { data: apiUrlFromHealth } = useQuery({
    queryKey: ['health', 'api-url'],
    queryFn: fetchRunnerApiUrl,
    enabled: !apiUrlProp,
    staleTime: 60_000,
  })

  const apiUrl = apiUrlProp ?? apiUrlFromHealth ?? window.location.origin
  const confSnippet = formatRunnerConf(token, apiUrl)

  async function copyText(text: string, kind: 'token' | 'config') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
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
            {confSnippet}
          </pre>
          <p className="text-sm text-text-secondary">
            Then restart:{' '}
            <code className="rounded bg-bg px-1 py-0.5 text-xs">sudo systemctl restart pertisk-runner</code>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-naturals-n4 px-5 py-4">
          <SecondaryButton type="button" onClick={() => copyText(token, 'token')}>
            {copied === 'token' ? (
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
          <SecondaryButton type="button" onClick={() => copyText(confSnippet, 'config')}>
            {copied === 'config' ? (
              <>
                <Check size={14} />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy config
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
