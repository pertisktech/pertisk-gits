import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  ChevronDown,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { CiConfigScope, CiSecret, CiSecretEnvironment, CiSecretKind } from '../api/types'
import { formatRelativeTimeFromIso } from '../lib/relativeTime'
import { cn } from '../utils/cn'
import { SecretDeleteDialog } from './SecretDeleteDialog'
import {
  SecretEnvBadge,
  SecretFormDialog,
  SecretKindBadge,
  type SecretFormValues,
} from './SecretFormDialog'
import { EmptyState, PrimaryButton, SecondaryButton } from './ui'

const SECRET_ENV_ORDER: CiSecretEnvironment[] = ['dev', 'qa', 'uat', 'prd', 'all']

const SECRET_ENV_LABELS: Record<CiSecretEnvironment, string> = {
  dev: 'Development',
  qa: 'QA',
  uat: 'UAT',
  prd: 'Production',
  all: 'All environments',
}

type EnvFilter = CiSecretEnvironment | 'all_envs'

interface SecretsPanelProps {
  token: string
  title: string
  description: string
  queryKey: string[]
  listSecrets: () => Promise<CiSecret[]>
  createSecret: (payload: {
    name: string
    secret_kind?: CiSecretKind
    config_scope?: CiConfigScope
    masked?: boolean
    environment?: CiSecretEnvironment
    value: string
  }) => Promise<CiSecret>
  updateSecret: (
    id: string,
    payload: {
      secret_kind?: CiSecretKind
      config_scope?: CiConfigScope
      masked?: boolean
      value?: string
    },
  ) => Promise<CiSecret>
  deleteSecret: (id: string) => Promise<void>
  embedded?: boolean
}

function itemScope(item: CiSecret): CiConfigScope {
  return item.config_scope ?? 'secret'
}

function pipelineReference(name: string, scope: CiConfigScope) {
  return scope === 'variable' ? `\${{ vars.${name} }}` : `\${{ secrets.${name} }}`
}

function groupSecretsByEnvironment(secrets: CiSecret[]) {
  const buckets = new Map<CiSecretEnvironment, CiSecret[]>()
  for (const env of SECRET_ENV_ORDER) {
    buckets.set(env, [])
  }
  for (const secret of secrets) {
    buckets.get(secret.environment)?.push(secret)
  }
  return SECRET_ENV_ORDER.map((environment) => ({
    environment,
    secrets: (buckets.get(environment) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.secrets.length > 0)
}

export function SecretsPanel({
  token,
  title,
  description,
  queryKey,
  listSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  embedded = false,
}: SecretsPanelProps) {
  const queryClient = useQueryClient()
  const [scopeTab, setScopeTab] = useState<CiConfigScope>('secret')
  const [search, setSearch] = useState('')
  const [envFilter, setEnvFilter] = useState<EnvFilter>('all_envs')
  const [guideOpen, setGuideOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'rotate'>('create')
  const [activeSecret, setActiveSecret] = useState<CiSecret | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CiSecret | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedRef, setCopiedRef] = useState<string | null>(null)

  const { data: secrets = [], isLoading } = useQuery({
    queryKey,
    queryFn: listSecrets,
    enabled: Boolean(token),
  })

  const scopedItems = useMemo(
    () => secrets.filter((item) => itemScope(item) === scopeTab),
    [scopeTab, secrets],
  )

  const filteredSecrets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scopedItems.filter((secret) => {
      if (envFilter !== 'all_envs' && secret.environment !== envFilter) return false
      if (!q) return true
      return (
        secret.name.toLowerCase().includes(q) ||
        (secret.value?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [envFilter, scopedItems, search])

  const groupedSecrets = useMemo(
    () => groupSecretsByEnvironment(filteredSecrets),
    [filteredSecrets],
  )

  const createMutation = useMutation({
    mutationFn: createSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      setFormOpen(false)
      setActiveSecret(null)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const rotateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: { value: string; masked?: boolean }
    }) => updateSecret(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      setFormOpen(false)
      setActiveSecret(null)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      setDeleteTarget(null)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function openCreateDialog() {
    setFormMode('create')
    setActiveSecret(null)
    setError(null)
    setFormOpen(true)
  }

  function openRotateDialog(secret: CiSecret) {
    setFormMode('rotate')
    setActiveSecret(secret)
    setError(null)
    setFormOpen(true)
  }

  async function copyReference(name: string, scope: CiConfigScope) {
    try {
      await navigator.clipboard.writeText(pipelineReference(name, scope))
      setCopiedRef(name)
      window.setTimeout(() => setCopiedRef((current) => (current === name ? null : current)), 2000)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  function onFormSubmit(values: SecretFormValues) {
    setError(null)
    if (formMode === 'create') {
      createMutation.mutate({
        name: values.name,
        secret_kind: values.secret_kind,
        config_scope: values.config_scope,
        masked: values.masked,
        environment: values.environment,
        value: values.value,
      })
      return
    }
    if (!activeSecret) return
    rotateMutation.mutate({
      id: activeSecret.id,
      payload: {
        value: values.value,
        masked: values.masked,
      },
    })
  }

  const isVariableTab = scopeTab === 'variable'

  const toolbar = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search secrets…"
          className="app-field w-full pl-9"
          aria-label="Search secrets"
        />
      </div>
      <PrimaryButton type="button" onClick={openCreateDialog}>
        <Plus size={14} />
        {isVariableTab ? 'Add variable' : 'Add secret'}
      </PrimaryButton>
    </div>
  )

  const envFilters = (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by environment">
      <EnvFilterChip
        active={envFilter === 'all_envs'}
        onClick={() => setEnvFilter('all_envs')}
        label="All"
      />
      {SECRET_ENV_ORDER.map((environment) => (
        <EnvFilterChip
          key={environment}
          active={envFilter === environment}
          onClick={() => setEnvFilter(environment)}
          label={SECRET_ENV_LABELS[environment]}
        />
      ))}
    </div>
  )

  const scopeTabs = (
    <div className="flex gap-1 rounded-lg border border-border bg-surface-elevated/40 p-1 w-fit">
      <ScopeTabButton
        active={scopeTab === 'secret'}
        onClick={() => setScopeTab('secret')}
        icon={<KeyRound size={14} />}
        label="Secrets"
        count={secrets.filter((s) => itemScope(s) === 'secret').length}
      />
      <ScopeTabButton
        active={scopeTab === 'variable'}
        onClick={() => setScopeTab('variable')}
        icon={<Link2 size={14} />}
        label="Variables"
        count={secrets.filter((s) => itemScope(s) === 'variable').length}
      />
    </div>
  )

  const guide = (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover/50 transition-colors"
        onClick={() => setGuideOpen((open) => !open)}
        aria-expanded={guideOpen}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-text">
          <BookOpen size={15} className="text-text-secondary" />
          How secrets work in pipelines
        </span>
        <ChevronDown
          size={16}
          className={cn('text-text-secondary transition-transform', guideOpen && 'rotate-180')}
        />
      </button>
      {guideOpen && (
        <div className="border-t border-border bg-surface-elevated/30 px-4 py-3 space-y-3 text-sm text-text-secondary">
          <p>
            {isVariableTab ? (
              <>
                Variables are non-sensitive config — SonarQube dashboard URLs, registry hostnames, feature
                flags. Use{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                  {'${{ vars.SONAR_HOST_URL }}'}
                </code>{' '}
                in pipelines; values stay visible here and appear in logs unless masked.
              </>
            ) : (
              <>
                Secrets are encrypted (passwords, tokens). Use the same key per environment with different
                values — e.g.{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">HARBOR_PASSWORD</code>.
                Reference as{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                  {'${{ secrets.HARBOR_PASSWORD }}'}
                </code>.
              </>
            )}
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-xs text-text">
{isVariableTab
  ? `jobs:
  sonar:
    environment: dev
    steps:
      - run: |
          sonar-scanner -Dsonar.host.url="$SONAR_HOST_URL"
          echo "Dashboard: \${{ vars.SONAR_DASHBOARD_URL }}"`
  : `jobs:
  build:
    environment: dev
    steps:
      - run: |
          docker login -u "\${{ secrets.HARBOR_USERNAME }}" \\
            -p "\${{ secrets.HARBOR_PASSWORD }}" \\
            "\${{ vars.HARBOR_REGISTRY }}"`}
          </pre>
          <p className="text-xs">
            Jobs receive secrets for their effective environment (<code className="font-mono">environment:</code> on the job, or inferred from branch / Run pipeline).
          </p>
        </div>
      )}
    </div>
  )

  const listBody = isLoading ? (
    <div className="flex items-center gap-2 py-10 text-sm text-text-secondary">
      <Loader2 size={16} className="animate-spin" />
      Loading secrets…
    </div>
  ) : filteredSecrets.length === 0 ? (
    <EmptyState
      icon={<KeyRound size={28} />}
      title={scopedItems.length === 0 ? (isVariableTab ? 'No variables yet' : 'No secrets yet') : 'No matching entries'}
      description={
        scopedItems.length === 0
          ? isVariableTab
            ? 'Add URLs and other non-sensitive config your pipelines need to print or open.'
            : 'Add registry credentials, tokens, and other sensitive values for your pipelines.'
          : 'Try a different search or environment filter.'
      }
      action={
        scopedItems.length === 0 ? (
          <PrimaryButton type="button" onClick={openCreateDialog}>
            <Plus size={14} />
            {isVariableTab ? 'Add your first variable' : 'Add your first secret'}
          </PrimaryButton>
        ) : undefined
      }
    />
  ) : envFilter === 'all_envs' ? (
    <div className="space-y-4">
      {groupedSecrets.map((group) => (
        <section key={group.environment} className="overflow-hidden rounded-lg border border-border">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-elevated/40 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <SecretEnvBadge environment={group.environment} />
              <span className="text-sm font-medium text-text">
                {SECRET_ENV_LABELS[group.environment]}
              </span>
            </div>
            <span className="text-xs text-text-secondary">
              {group.secrets.length} {isVariableTab ? 'variable' : 'secret'}
              {group.secrets.length === 1 ? '' : 's'}
            </span>
          </header>
          <SecretTable
            secrets={group.secrets}
            scope={scopeTab}
            copiedRef={copiedRef}
            onCopy={copyReference}
            onRotate={openRotateDialog}
            onDelete={setDeleteTarget}
            pendingDeleteId={deleteMutation.isPending ? deleteTarget?.id : undefined}
          />
        </section>
      ))}
    </div>
  ) : (
    <div className="overflow-hidden rounded-lg border border-border">
      <SecretTable
        secrets={filteredSecrets.sort((a, b) => a.name.localeCompare(b.name))}
        scope={scopeTab}
        copiedRef={copiedRef}
        onCopy={copyReference}
        onRotate={openRotateDialog}
        onDelete={setDeleteTarget}
        pendingDeleteId={deleteMutation.isPending ? deleteTarget?.id : undefined}
        showEnvironment
      />
    </div>
  )

  const body = (
    <div className="space-y-4">
      {!embedded && description && (
        <p className="text-sm text-text-secondary">{description}</p>
      )}

      {guide}
      {scopeTabs}
      {toolbar}
      {envFilters}

      {error && !formOpen && !deleteTarget && (
        <div className="rounded-md border border-red-r1/30 bg-dashboard-danger-bg px-3 py-2 text-sm text-dashboard-danger">
          {error}
        </div>
      )}

      {listBody}

      <SecretFormDialog
        open={formOpen}
        mode={formMode}
        defaultScope={scopeTab}
        secret={activeSecret}
        pending={createMutation.isPending || rotateMutation.isPending}
        error={error}
        onClose={() => {
          if (createMutation.isPending || rotateMutation.isPending) return
          setFormOpen(false)
          setActiveSecret(null)
          setError(null)
        }}
        onSubmit={onFormSubmit}
      />

      <SecretDeleteDialog
        open={deleteTarget != null}
        secret={deleteTarget}
        pending={deleteMutation.isPending}
        error={error}
        onClose={() => {
          if (deleteMutation.isPending) return
          setDeleteTarget(null)
          setError(null)
        }}
        onConfirm={() => {
          if (!deleteTarget) return
          deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )

  if (embedded) return body

  return (
    <div className="app-panel max-w-6xl">
      <div className="app-panel-header flex items-center gap-2">
        <KeyRound size={16} />
        {title}
      </div>
      <div className="app-panel-body">{body}</div>
    </div>
  )
}

function EnvFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary-p4/40 bg-primary-p4/10 text-text'
          : 'border-border text-text-secondary hover:border-naturals-n5 hover:text-text',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function ScopeTabButton({
  active,
  label,
  icon,
  count,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary">
        {count}
      </span>
    </button>
  )
}

function SecretTable({
  secrets,
  scope,
  copiedRef,
  onCopy,
  onRotate,
  onDelete,
  pendingDeleteId,
  showEnvironment = false,
}: {
  secrets: CiSecret[]
  scope: CiConfigScope
  copiedRef: string | null
  onCopy: (name: string, scope: CiConfigScope) => void
  onRotate: (secret: CiSecret) => void
  onDelete: (secret: CiSecret) => void
  pendingDeleteId?: string
  showEnvironment?: boolean
}) {
  const showValue = scope === 'variable'
  return (
    <div className={cn('min-w-0', !showValue && 'overflow-x-auto')}>
      <table className={cn('w-full text-sm', showValue ? 'table-fixed' : 'min-w-[640px]')}>
        {showValue && (
          <colgroup>
            <col className="w-[24%]" />
            <col />
            {showEnvironment && <col className="w-[12%]" />}
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[1%]" />
          </colgroup>
        )}
        <thead>
          <tr className="border-b border-border bg-surface-elevated/20 text-left text-xs uppercase tracking-wide text-text-secondary">
            <th className="px-4 py-2.5 font-medium">Key</th>
            {showValue && <th className="px-4 py-2.5 font-medium">Value</th>}
            {showEnvironment && <th className="px-4 py-2.5 font-medium">Environment</th>}
            {!showValue && <th className="px-4 py-2.5 font-medium">Type</th>}
            {showValue && <th className="px-4 py-2.5 font-medium">Masked</th>}
            <th className="px-4 py-2.5 font-medium">Updated</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {secrets.map((secret) => (
            <tr key={secret.id} className="hover:bg-hover/30 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-medium text-text truncate">{secret.name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-text-secondary hover:bg-surface-2 hover:text-text"
                    title="Copy pipeline reference"
                    onClick={() => onCopy(secret.name, scope)}
                  >
                    <Copy size={13} />
                  </button>
                  {copiedRef === secret.name && (
                    <span className="text-[11px] text-dashboard-success">Copied</span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-text-secondary truncate">
                  {pipelineReference(secret.name, scope)}
                </div>
              </td>
              {showValue && (
                <td className="px-4 py-3 align-top min-w-0">
                  <div className="max-h-28 overflow-auto rounded-md border border-border/40 bg-surface-elevated/20 px-2.5 py-1.5 font-mono text-xs leading-relaxed text-text-secondary break-all">
                    {secret.value ?? '—'}
                  </div>
                </td>
              )}
              {showEnvironment && (
                <td className="px-4 py-3">
                  <SecretEnvBadge environment={secret.environment} />
                </td>
              )}
              {!showValue && (
                <td className="px-4 py-3">
                  <SecretKindBadge kind={secret.secret_kind} />
                </td>
              )}
              {showValue && (
                <td className="px-4 py-3 text-text-secondary">
                  {secret.masked ? 'Yes' : 'No'}
                </td>
              )}
              <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                {formatRelativeTimeFromIso(secret.updated_at)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <SecondaryButton
                    type="button"
                    className="px-2 py-1"
                    onClick={() => onRotate(secret)}
                  >
                    <Pencil size={14} />
                    <span className="sr-only sm:not-sr-only sm:inline">Edit</span>
                  </SecondaryButton>
                  <SecondaryButton
                    type="button"
                    className="px-2 py-1 text-dashboard-danger hover:text-dashboard-danger"
                    disabled={pendingDeleteId === secret.id}
                    onClick={() => onDelete(secret)}
                  >
                    <Trash2 size={14} />
                    <span className="sr-only sm:not-sr-only sm:inline">Delete</span>
                  </SecondaryButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
