import { FileKey, KeyRound, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CiSecret, CiSecretEnvironment, CiSecretKind } from '../api/types'
import { PrimaryButton, SecondaryButton, Select } from './ui'

export interface SecretFormValues {
  name: string
  secret_kind: CiSecretKind
  environment: CiSecretEnvironment
  value: string
}

export function SecretFormDialog({
  open,
  mode,
  secret,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'rotate'
  secret?: CiSecret | null
  pending?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (values: SecretFormValues) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CiSecretKind>('variable')
  const [environment, setEnvironment] = useState<CiSecretEnvironment>('dev')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) return
    if (mode === 'rotate' && secret) {
      setName(secret.name)
      setKind(secret.secret_kind)
      setEnvironment(secret.environment)
      setValue('')
      return
    }
    setName('')
    setKind('variable')
    setEnvironment('dev')
    setValue('')
  }, [open, mode, secret])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  if (!open) return null

  const isCreate = mode === 'create'
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
        className="w-full max-w-lg rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="secret-form-title" className="text-base font-semibold text-text">
              {isCreate ? 'Add secret' : 'Update secret value'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {isCreate
                ? 'Values are encrypted and never shown again after saving.'
                : `Replace the stored value for ${secret?.name ?? 'this secret'}.`}
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
              secret_kind: kind,
              environment,
              value: value.trim(),
            })
          }}
        >
          {isCreate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-sm font-medium text-text" htmlFor="secret-form-name">
                  Name
                </label>
                <input
                  id="secret-form-name"
                  className="app-field font-mono text-sm"
                  value={name}
                  disabled={pending}
                  autoFocus
                  placeholder="HARBOR_REGISTRY"
                  pattern="[A-Z][A-Z0-9_]*"
                  onChange={(event) => setName(event.target.value.toUpperCase())}
                  required
                />
              </div>
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
              id="secret-form-value"
              className="app-field min-h-24 resize-y font-mono text-xs"
              value={value}
              disabled={pending}
              autoFocus={!isCreate}
              placeholder={kind === 'file' ? '-----BEGIN PRIVATE KEY-----' : 'harbor.example.com'}
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </div>

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
              {pending ? 'Saving…' : isCreate ? 'Add secret' : 'Update value'}
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
