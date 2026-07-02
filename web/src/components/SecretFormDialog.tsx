import { FileKey, KeyRound, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../utils/cn'
import type { CiConfigScope, CiSecret, CiSecretEnvironment, CiSecretKind } from '../api/types'
import { Checkbox, PrimaryButton, SecondaryButton, Select } from './ui'

export interface SecretFormValues {
  name: string
  secret_kind: CiSecretKind
  config_scope: CiConfigScope
  masked: boolean
  environment: CiSecretEnvironment
  value: string
}

export function SecretFormDialog({
  open,
  mode,
  defaultScope,
  secret,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'rotate'
  defaultScope: CiConfigScope
  secret?: CiSecret | null
  pending?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (values: SecretFormValues) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CiSecretKind>('variable')
  const [scope, setScope] = useState<CiConfigScope>(defaultScope)
  const [masked, setMasked] = useState(defaultScope === 'secret')
  const [environment, setEnvironment] = useState<CiSecretEnvironment>('dev')
  const [value, setValue] = useState('')
  const valueRef = useRef<HTMLTextAreaElement>(null)

  const isVariable = scope === 'variable'
  const isCreate = mode === 'create'

  useEffect(() => {
    if (!open) return
    if (mode === 'rotate' && secret) {
      setName(secret.name)
      setKind(secret.secret_kind)
      setScope(secret.config_scope)
      setMasked(secret.masked)
      setEnvironment(secret.environment)
      setValue(secret.config_scope === 'variable' ? secret.value ?? '' : '')
      return
    }
    setName('')
    setKind('variable')
    setScope(defaultScope)
    setMasked(defaultScope === 'secret')
    setEnvironment('dev')
    setValue('')
  }, [open, mode, secret, defaultScope])

  const syncValueHeight = useCallback(() => {
    const el = valueRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 240
    const nextHeight = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${Math.max(nextHeight, 96)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    if (!open) return
    syncValueHeight()
  }, [open, value, syncValueHeight])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  if (!open) return null

  const trimmedName = name.trim().toUpperCase()
  const canSubmit = Boolean(trimmedName) && Boolean(value.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!pending) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-form-title"
        className={cn(
          'w-full rounded-lg border border-naturals-n4 bg-surface shadow-xl',
          isVariable ? 'max-w-2xl' : 'max-w-lg',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="secret-form-title" className="text-base font-semibold text-text">
              {isCreate
                ? isVariable
                  ? 'Add variable'
                  : 'Add secret'
                : isVariable
                  ? 'Edit variable'
                  : 'Update secret value'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {isVariable
                ? 'Non-sensitive config (URLs, hostnames). Visible here and referenced as ${{ vars.NAME }}.'
                : 'Sensitive values are encrypted and referenced as ${{ secrets.NAME }}.'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-text-secondary hover:bg-hover hover:text-text"
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit || pending) return
            onSubmit({
              name: trimmedName,
              secret_kind: isVariable ? 'variable' : kind,
              config_scope: scope,
              masked: isVariable ? masked : true,
              environment,
              value: value.trim(),
            })
          }}
        >
          {isCreate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-sm font-medium text-text" htmlFor="secret-form-name">
                  Key
                </label>
                <input
                  id="secret-form-name"
                  className="app-field font-mono text-sm"
                  value={name}
                  disabled={pending}
                  autoFocus
                  placeholder={isVariable ? 'SONAR_HOST_URL' : 'HARBOR_PASSWORD'}
                  pattern="[A-Z][A-Z0-9_]*"
                  onChange={(event) => setName(event.target.value.toUpperCase())}
                  required
                />
              </div>
              {!isVariable && (
                <Select
                  id="secret-form-kind"
                  label="Type"
                  value={kind}
                  disabled={pending}
                  onChange={(event) => setKind(event.target.value as CiSecretKind)}
                >
                  <option value="variable">Variable</option>
                  <option value="file">File</option>
                </Select>
              )}
              <Select
                id="secret-form-environment"
                label="Environment"
                value={environment}
                disabled={pending}
                onChange={(event) => setEnvironment(event.target.value as CiSecretEnvironment)}
              >
                <option value="dev">dev</option>
                <option value="qa">qa</option>
                <option value="uat">uat</option>
                <option value="prd">prd</option>
                <option value="all">All environments</option>
              </Select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-elevated/50 px-3 py-2 text-sm">
              <span className="font-mono font-medium text-text">{secret?.name}</span>
              <SecretEnvBadge environment={secret?.environment ?? 'dev'} />
              <SecretKindBadge kind={secret?.secret_kind ?? 'variable'} />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="secret-form-value">
              {isCreate ? 'Value' : 'New value'}
            </label>
            <textarea
              ref={valueRef}
              id="secret-form-value"
              className="app-field min-h-24 resize-none overflow-hidden font-mono text-xs"
              value={value}
              disabled={pending}
              autoFocus={!isCreate}
              placeholder={
                isVariable
                  ? 'https://sonar.example.com/dashboard?id=my-project'
                  : kind === 'file'
                    ? '-----BEGIN PRIVATE KEY-----'
                    : 'harbor.example.com'
              }
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </div>

          {isVariable && (
            <Checkbox
              id="secret-form-masked"
              label="Mask in job logs"
              description="Hide this value in streamed logs (use for tokens that are not passwords)."
              checked={masked}
              disabled={pending}
              onChange={(event) => setMasked(event.target.checked)}
            />
          )}

          {error && <p className="text-sm text-dashboard-danger">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-naturals-n4 pt-4">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={pending || !canSubmit}>
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isCreate ? (
                <KeyRound size={14} />
              ) : (
                <FileKey size={14} />
              )}
              {pending ? 'Saving…' : isCreate ? 'Save' : 'Update'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}

export function SecretEnvBadge({ environment }: { environment: CiSecretEnvironment }) {
  const styles: Record<CiSecretEnvironment, string> = {
    dev: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    qa: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    uat: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    prd: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    all: 'border-border bg-surface-2 text-text-secondary',
  }
  const labels: Record<CiSecretEnvironment, string> = {
    dev: 'dev',
    qa: 'qa',
    uat: 'uat',
    prd: 'prd',
    all: 'all envs',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[environment]}`}
    >
      {labels[environment]}
    </span>
  )
}

export function SecretKindBadge({ kind }: { kind: CiSecretKind }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium capitalize text-text-secondary">
      {kind}
    </span>
  )
}
