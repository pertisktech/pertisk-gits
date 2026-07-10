import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, GitCompare, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { parseUnifiedDiff, type DiffFile, fileStatusLabel } from '../lib/unifiedDiff'
import { DiffViewer } from './DiffViewer'
import { EmptyState, PrimaryButton, RefSelect } from './ui'

interface RepoCompareProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

type RefKind = 'branch' | 'tag'

function fileToUnifiedDiff(file: DiffFile): string {
  const oldPath = file.oldPath ?? file.path
  const newPath = file.path
  const lines: string[] = [
    `diff --git a/${oldPath} b/${newPath}`,
  ]

  if (file.status === 'added') {
    lines.push('new file mode 100644')
    lines.push('--- /dev/null')
    lines.push(`+++ b/${newPath}`)
  } else if (file.status === 'deleted') {
    lines.push('deleted file mode 100644')
    lines.push(`--- a/${oldPath}`)
    lines.push('+++ /dev/null')
  } else if (file.status === 'renamed') {
    lines.push(`rename from ${oldPath}`)
    lines.push(`rename to ${newPath}`)
    lines.push(`--- a/${oldPath}`)
    lines.push(`+++ b/${newPath}`)
  } else {
    lines.push(`--- a/${oldPath}`)
    lines.push(`+++ b/${newPath}`)
  }

  for (const line of file.lines) {
    if (line.kind === 'hunk') lines.push(line.text)
    else if (line.kind === 'add') lines.push(`+${line.text}`)
    else if (line.kind === 'del') lines.push(`-${line.text}`)
    else lines.push(` ${line.text}`)
  }

  return lines.join('\n')
}

export function RepoCompare({ token, orgSlug, repoSlug, defaultBranch }: RepoCompareProps) {
  const [baseKind, setBaseKind] = useState<RefKind>('branch')
  const [baseRef, setBaseRef] = useState('')
  const [headKind, setHeadKind] = useState<RefKind>('branch')
  const [headRef, setHeadRef] = useState(defaultBranch)
  const [refsInitialized, setRefsInitialized] = useState(false)
  const [appliedCompare, setAppliedCompare] = useState<{
    baseKind: RefKind
    baseRef: string
    headKind: RefKind
    headRef: string
  } | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const { data: browserData, isLoading: browserLoading, error: browserError } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data: branchesData, isLoading: branchesLoading } = useQuery({
    queryKey: ['repo-branches', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoBranches(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data: tagsData, isLoading: tagsLoading } = useQuery({
    queryKey: ['repo-tags', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoTags(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const branches = useMemo(
    () =>
      branchesData?.branches.map((branch) => branch.name)
      ?? browserData?.browser.branches
      ?? [],
    [branchesData?.branches, browserData?.browser.branches],
  )
  const tags = useMemo(
    () =>
      tagsData?.tags.map((tag) => tag.name)
      ?? browserData?.browser.tags
      ?? [],
    [tagsData?.tags, browserData?.browser.tags],
  )
  const hasAnyRefs = branches.length > 0 || tags.length > 0

  useEffect(() => {
    setRefsInitialized(false)
    setAppliedCompare(null)
  }, [orgSlug, repoSlug])

  useEffect(() => {
    if (branchesLoading || tagsLoading) return
    if (refsInitialized) return
    if (!hasAnyRefs) {
      setRefsInitialized(false)
      return
    }

    const nextHeadKind: RefKind = 'branch'
    const nextHead = branches.includes(defaultBranch)
      ? defaultBranch
      : (branches[0] ?? tags[0] ?? defaultBranch)

    setBaseKind('branch')
    setBaseRef('')
    setHeadKind(nextHeadKind)
    setHeadRef(nextHead)
    setRefsInitialized(true)
  }, [
    branchesLoading,
    tagsLoading,
    refsInitialized,
    hasAnyRefs,
    branches,
    tags,
    defaultBranch,
  ])

  useEffect(() => {
    if (!refsInitialized) return

    const nextHeadIsValid =
      (headKind === 'branch' && branches.includes(headRef))
      || (headKind === 'tag' && tags.includes(headRef))
    const nextBaseIsValid =
      !baseRef
      ||
      (baseKind === 'branch' && branches.includes(baseRef))
      || (baseKind === 'tag' && tags.includes(baseRef))

    if (!nextHeadIsValid) {
      setHeadKind('branch')
      setHeadRef(
        branches.includes(defaultBranch)
          ? defaultBranch
          : (branches[0] ?? tags[0] ?? defaultBranch),
      )
    }

    if (!nextBaseIsValid) {
      setBaseKind('branch')
      setBaseRef('')
    }
  }, [refsInitialized, headKind, headRef, baseKind, baseRef, branches, tags, defaultBranch])

  const compareEnabled = Boolean(
    refsInitialized && hasAnyRefs && baseRef && headRef,
  )
  const isSameRevision = Boolean(
    appliedCompare
      && appliedCompare.baseKind === appliedCompare.headKind
      && appliedCompare.baseRef === appliedCompare.headRef,
  )

  const {
    data: compare,
    isLoading: compareLoading,
    isFetching: compareFetching,
    error: compareError,
  } = useQuery({
    queryKey: [
      'repo-compare',
      orgSlug,
      repoSlug,
      appliedCompare?.baseKind ?? 'branch',
      appliedCompare?.baseRef ?? '',
      appliedCompare?.headKind ?? 'branch',
      appliedCompare?.headRef ?? '',
      token ?? 'public',
    ],
    queryFn: () =>
      api.getRepoCompare(
        orgSlug,
        repoSlug,
        {
          base: appliedCompare!.baseRef,
          head: appliedCompare!.headRef,
          base_kind: appliedCompare!.baseKind,
          head_kind: appliedCompare!.headKind,
        },
        token,
      ),
    enabled: compareEnabled && appliedCompare !== null && !isSameRevision,
    retry: false,
  })

  const effectiveCompare = appliedCompare && isSameRevision
    ? {
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        commits: [],
        mergeable: true,
        diff: '',
      }
    : compare

  const summaryText = useMemo(() => {
    if (!effectiveCompare) return null
    return `${effectiveCompare.files_changed} files changed, +${effectiveCompare.insertions} / -${effectiveCompare.deletions}`
  }, [effectiveCompare])

  const compareFiles = useMemo(
    () => (effectiveCompare?.diff ? parseUnifiedDiff(effectiveCompare.diff) : []),
    [effectiveCompare?.diff],
  )

  useEffect(() => {
    if (compareFiles.length === 0) {
      setSelectedPath(null)
      return
    }

    if (!selectedPath || !compareFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(compareFiles[0].path)
    }
  }, [compareFiles, selectedPath])

  const selectedFile = useMemo(
    () => compareFiles.find((file) => file.path === selectedPath) ?? compareFiles[0],
    [compareFiles, selectedPath],
  )
  const selectedFileDiff = useMemo(
    () => (selectedFile ? fileToUnifiedDiff(selectedFile) : ''),
    [selectedFile],
  )

  if (branchesLoading || tagsLoading || (browserLoading && !hasAnyRefs)) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading source/target references…
        </div>
      </div>
    )
  }

  if (!hasAnyRefs) {
    return (
      <div className="app-panel">
        <EmptyState
          icon={<GitCompare size={40} />}
          title="No revisions to compare"
          description="Push your first commit before comparing branches or tags."
        />
        {browserError && (
          <div className="app-panel-body pt-0 text-xs text-dashboard-danger">
            {(browserError as Error).message}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="app-panel">
        <div className="app-panel-header">Compare revisions</div>
        <div className="app-panel-body space-y-3">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <span className="text-xs text-text-secondary whitespace-nowrap">Source</span>
            <RefSelect
              refKind={headKind}
              refName={headRef}
              branches={branches}
              tags={tags}
              fallbackRef={defaultBranch}
              alwaysMenu
              onChange={(kind, name) => {
                setHeadKind(kind)
                setHeadRef(name)
              }}
              aria-label="Source revision"
              className="w-44 flex-none"
            />

            <span className="text-xs text-text-secondary whitespace-nowrap">Target</span>

            <RefSelect
              refKind={baseKind}
              refName={baseRef}
              branches={branches}
              tags={tags}
              fallbackRef={defaultBranch}
              alwaysMenu
              placeholder="Select target"
              onChange={(kind, name) => {
                setBaseKind(kind)
                setBaseRef(name)
              }}
              aria-label="Target revision"
              className="w-44 flex-none"
            />

            <PrimaryButton
              type="button"
              className="px-3"
              onClick={() => {
                setBaseKind(headKind)
                setBaseRef(headRef)
                setHeadKind(baseKind)
                setHeadRef(baseRef)
              }}
              aria-label="Swap source and target"
              title="Swap"
            >
              <ArrowRightLeft size={14} />
            </PrimaryButton>

            <PrimaryButton
              type="button"
              className="px-3"
              disabled={!compareEnabled}
              onClick={() => {
                setAppliedCompare({
                  baseKind,
                  baseRef,
                  headKind,
                  headRef,
                })
              }}
            >
              Compare
            </PrimaryButton>
          </div>

          {compareFetching && (
            <p className="text-xs text-text-secondary">Refreshing comparison…</p>
          )}

          {!appliedCompare && (
            <p className="text-xs text-text-secondary">
              Select source and target, then press Compare.
            </p>
          )}

          {effectiveCompare && (
            <div className="text-xs text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{summaryText}</span>
              <span>{effectiveCompare.mergeable ? 'Mergeable' : 'Has conflicts'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="app-panel">
        <div className="app-panel-body">
          {!appliedCompare ? (
            <EmptyState
              icon={<GitCompare size={40} />}
              title="Ready to compare"
              description="Select source and target revisions, then press Compare."
            />
          ) : compareLoading ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Loader2 size={16} className="animate-spin" />
              Comparing revisions…
            </div>
          ) : compareError ? (
            <div className="text-sm text-dashboard-danger">{(compareError as Error).message}</div>
          ) : effectiveCompare?.diff?.trim() ? (
            compareFiles.length > 0 && selectedFile ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <aside className="rounded-lg border border-naturals-n4 bg-surface-elevated p-2 max-h-[70vh] overflow-auto">
                  <p className="px-2 py-1 text-xs font-semibold text-text-secondary">Changed files</p>
                  <ul className="space-y-1">
                    {compareFiles.map((file) => (
                      <li key={file.path}>
                        <button
                          type="button"
                          className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${selectedFile.path === file.path ? 'bg-hover text-text' : 'text-text-secondary hover:bg-hover hover:text-text'}`}
                          onClick={() => setSelectedPath(file.path)}
                        >
                          <div className="truncate font-mono">{file.path}</div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px]">
                            <span>{fileStatusLabel(file.status)}</span>
                            <span>
                              <span className="text-dashboard-success">+{file.insertions}</span>{' '}
                              <span className="text-dashboard-danger">-{file.deletions}</span>
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
                <div className="min-w-0">
                  <DiffViewer diff={selectedFileDiff} />
                </div>
              </div>
            ) : (
              <DiffViewer diff={effectiveCompare.diff} />
            )
          ) : (
            <EmptyState
              icon={<GitCompare size={40} />}
              title="No diff"
              description="These references point to the same content."
            />
          )}
        </div>
      </div>
    </div>
  )
}
