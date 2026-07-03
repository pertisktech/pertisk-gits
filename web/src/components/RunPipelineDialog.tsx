import { Loader2, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CI_ENVIRONMENTS, type CiEnvironment } from '../lib/pipelineSummary'
import { PrimaryButton, Radio, RadioGroup, SecondaryButton, Select } from './ui'

export interface RunPipelineParams {
  refKind: 'branch' | 'tag'
  refName: string
  environment?: CiEnvironment
}

export function RunPipelineDialog({
  open,
  branches,
  tags,
  defaultBranch,
  pending,
  initialEnvironment,
  initialRefKind = 'branch',
  initialRefName,
  lockEnvironment = false,
  onClose,
  onRun,
}: {
  open: boolean
  branches: string[]
  tags: string[]
  defaultBranch: string
  pending?: boolean
  initialEnvironment?: CiEnvironment
  initialRefKind?: 'branch' | 'tag'
  initialRefName?: string
  lockEnvironment?: boolean
  onClose: () => void
  onRun: (params: RunPipelineParams) => void
}) {
  const [refKind, setRefKind] = useState<'branch' | 'tag'>(initialRefKind)
  const [refName, setRefName] = useState(initialRefName ?? defaultBranch)
  const [environment, setEnvironment] = useState<CiEnvironment | ''>(initialEnvironment ?? '')

  const refList = refKind === 'tag' ? tags : branches.length > 0 ? branches : [defaultBranch]

  useEffect(() => {
    if (!open) return
    setRefKind(initialRefKind)
    setEnvironment(initialEnvironment ?? '')
    const list = initialRefKind === 'tag' ? tags : branches.length > 0 ? branches : [defaultBranch]
    const preferred =
      initialRefName && list.includes(initialRefName)
        ? initialRefName
        : initialRefKind === 'branch'
          ? list.includes(defaultBranch)
            ? defaultBranch
            : list[0]
          : list[0]
    setRefName(preferred ?? defaultBranch)
  }, [open, initialRefKind, initialRefName, initialEnvironment, branches, tags, defaultBranch])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  useEffect(() => {
    if (!refList.includes(refName)) {
      setRefName(refList[0] ?? defaultBranch)
    }
  }, [refKind, refList, refName, defaultBranch])

  const branchCount = branches.length
  const tagCount = tags.length
  const canRun = refList.length > 0 && Boolean(refName)

  const summary = useMemo(() => {
    const refLabel = refKind === 'tag' ? `tag ${refName}` : `branch ${refName}`
    if (environment) return `Manual run on ${refLabel} → ${environment}`
    return `Manual run on ${refLabel} (same jobs as push)`
  }, [refKind, refName, environment])

  if (!open) return null

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
        aria-labelledby="run-pipeline-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="run-pipeline-title" className="text-base font-semibold text-text">
              Run pipeline
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Select branch or tag. Leave environment unset to run the same jobs as a push on this branch.
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

        <div className="space-y-4 px-5 py-4">
          <RadioGroup label="Ref type" row>
            <Radio
              name="run-pipeline-ref-kind"
              value="branch"
              label="Branch"
              checked={refKind === 'branch'}
              disabled={pending}
              onChange={() => setRefKind('branch')}
            />
            <Radio
              name="run-pipeline-ref-kind"
              value="tag"
              label="Tag"
              checked={refKind === 'tag'}
              disabled={pending}
              onChange={() => setRefKind('tag')}
            />
          </RadioGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              id="run-pipeline-ref"
              label={refKind === 'tag' ? 'Tag' : 'Branch'}
              className="font-mono text-sm"
              value={refName}
              disabled={pending || refList.length === 0}
              onChange={(event) => setRefName(event.target.value)}
            >
              {refList.length === 0 ? (
                <option value={refName}>{refKind === 'tag' ? 'No tags' : refName}</option>
              ) : (
                refList.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))
              )}
            </Select>
          </div>

          <Select
            id="run-pipeline-environment"
            label="Environment (optional)"
            value={environment}
            disabled={pending || lockEnvironment}
            onChange={(event) =>
              setEnvironment(event.target.value as CiEnvironment | '')
            }
          >
            <option value="">None — same as push</option>
            {CI_ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </Select>

          <p className="text-xs text-text-secondary">
            {branchCount} branch{branchCount === 1 ? '' : 'es'} · {tagCount} tag
            {tagCount === 1 ? '' : 's'}
          </p>
          <p className="text-xs font-mono text-text-secondary rounded-md border border-naturals-n4 bg-naturals-n2 px-3 py-2">
            {summary}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-naturals-n4 px-5 py-4">
          <SecondaryButton type="button" disabled={pending} onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            disabled={pending || !canRun}
            onClick={() =>
              onRun({
                refKind,
                refName,
                ...(environment ? { environment } : {}),
              })
            }
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Run pipeline
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
