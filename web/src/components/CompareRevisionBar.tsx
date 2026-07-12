import { ArrowRightLeft, GitCommit } from 'lucide-react'
import { PrimaryButton, RefSelect } from './ui'

export type CompareRefKind = 'branch' | 'tag' | 'revision'

export type AppliedCompare = {
  baseKind: CompareRefKind
  baseRef: string
  headKind: CompareRefKind
  headRef: string
}

function RevisionRefDisplay({ sha, label }: { sha: string; label?: string }) {
  const short = sha.length > 12 ? sha.slice(0, 7) : sha
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-naturals-n4 bg-surface px-2.5 py-1.5 text-sm font-mono text-text min-w-[8rem]">
      <GitCommit size={14} className="shrink-0 text-primary" aria-hidden />
      <span title={sha}>{label ?? short}</span>
    </span>
  )
}

export function CompareRevisionBar({
  baseKind,
  baseRef,
  headKind,
  headRef,
  branches,
  tags,
  defaultBranch,
  onBaseChange,
  onHeadChange,
  onSwap,
  onCompare,
  compareEnabled,
  lockBase,
  lockHead,
  compareLabel = 'Compare',
}: {
  baseKind: CompareRefKind
  baseRef: string
  headKind: CompareRefKind
  headRef: string
  branches: string[]
  tags: string[]
  defaultBranch: string
  onBaseChange: (kind: CompareRefKind, ref: string) => void
  onHeadChange: (kind: CompareRefKind, ref: string) => void
  onSwap: () => void
  onCompare: () => void
  compareEnabled: boolean
  lockBase?: boolean
  lockHead?: boolean
  compareLabel?: string
}) {
  const canSwap = !lockBase && !lockHead

  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
      <span className="text-xs text-text-secondary whitespace-nowrap">Source</span>
      {lockHead || headKind === 'revision' ? (
        <RevisionRefDisplay sha={headRef} />
      ) : (
        <RefSelect
          refKind={headKind === 'tag' ? 'tag' : 'branch'}
          refName={headRef}
          branches={branches}
          tags={tags}
          fallbackRef={defaultBranch}
          alwaysMenu
          onChange={(kind, name) => onHeadChange(kind, name)}
          aria-label="Source revision"
          className="w-44 flex-none"
        />
      )}

      <span className="text-xs text-text-secondary whitespace-nowrap">Target</span>
      {lockBase || baseKind === 'revision' ? (
        <RevisionRefDisplay sha={baseRef} />
      ) : (
        <RefSelect
          refKind={baseKind === 'tag' ? 'tag' : 'branch'}
          refName={baseRef}
          branches={branches}
          tags={tags}
          fallbackRef={defaultBranch}
          alwaysMenu
          placeholder="Select target"
          onChange={(kind, name) => onBaseChange(kind, name)}
          aria-label="Target revision"
          className="w-44 flex-none"
        />
      )}

      {canSwap && (
        <PrimaryButton
          type="button"
          className="px-3"
          onClick={onSwap}
          aria-label="Swap source and target"
          title="Swap"
        >
          <ArrowRightLeft size={14} />
        </PrimaryButton>
      )}

      <PrimaryButton
        type="button"
        className="px-3"
        disabled={!compareEnabled}
        onClick={onCompare}
      >
        {compareLabel}
      </PrimaryButton>
    </div>
  )
}
