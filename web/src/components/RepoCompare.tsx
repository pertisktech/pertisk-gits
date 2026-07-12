import { useQuery } from '@tanstack/react-query'
import { GitCompare, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { CompareDiffPanel } from './CompareDiffPanel'
import { CompareRevisionBar, type AppliedCompare, type CompareRefKind } from './CompareRevisionBar'
import { CompareSummaryStats } from './CompareSummaryStats'
import { CompareCommitList } from './CompareCommitList'
import { RepoDetailTabs } from './RepoDetailTabs'
import { EmptyState } from './ui'

interface RepoCompareProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

type RefKind = CompareRefKind

function parseRefKind(value: string | null): RefKind {
  if (value === 'tag' || value === 'revision') return value
  return 'branch'
}

export function RepoCompare({ token, orgSlug, repoSlug, defaultBranch }: RepoCompareProps) {
  const [searchParams] = useSearchParams()
  const urlBase = searchParams.get('base')
  const urlHead = searchParams.get('head')
  const urlBaseKind = parseRefKind(searchParams.get('base_kind'))
  const urlHeadKind = parseRefKind(searchParams.get('head_kind'))
  const hasUrlCompare = Boolean(urlBase && urlHead)

  const [baseKind, setBaseKind] = useState<RefKind>('branch')
  const [baseRef, setBaseRef] = useState('')
  const [headKind, setHeadKind] = useState<RefKind>('branch')
  const [headRef, setHeadRef] = useState(defaultBranch)
  const [refsInitialized, setRefsInitialized] = useState(false)
  const [appliedCompare, setAppliedCompare] = useState<AppliedCompare | null>(null)
  const [activeTab, setActiveTab] = useState<'changes' | 'commits'>('changes')

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
    if (hasUrlCompare && urlBase && urlHead) {
      setBaseKind(urlBaseKind)
      setBaseRef(urlBase)
      setHeadKind(urlHeadKind)
      setHeadRef(urlHead)
      setAppliedCompare({
        baseKind: urlBaseKind,
        baseRef: urlBase,
        headKind: urlHeadKind,
        headRef: urlHead,
      })
      setRefsInitialized(true)
      return
    }

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
    hasUrlCompare,
    urlBase,
    urlHead,
    urlBaseKind,
    urlHeadKind,
    branchesLoading,
    tagsLoading,
    refsInitialized,
    hasAnyRefs,
    branches,
    tags,
    defaultBranch,
  ])

  useEffect(() => {
    if (!refsInitialized || hasUrlCompare) return

    const nextHeadIsValid =
      headKind === 'revision'
      || (headKind === 'branch' && branches.includes(headRef))
      || (headKind === 'tag' && tags.includes(headRef))
    const nextBaseIsValid =
      !baseRef
      || baseKind === 'revision'
      || (baseKind === 'branch' && branches.includes(baseRef))
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
  }, [refsInitialized, hasUrlCompare, headKind, headRef, baseKind, baseRef, branches, tags, defaultBranch])

  const compareEnabled = Boolean(
    refsInitialized && (hasUrlCompare || hasAnyRefs) && baseRef && headRef,
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
        base: appliedCompare.baseRef,
        head: appliedCompare.headRef,
        merge_base: appliedCompare.baseRef,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        commits: [],
        mergeable: true,
        diff: '',
      }
    : compare

  if (branchesLoading || tagsLoading || (browserLoading && !hasAnyRefs && !hasUrlCompare)) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading source/target references…
        </div>
      </div>
    )
  }

  if (!hasAnyRefs && !hasUrlCompare) {
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
          <CompareRevisionBar
            baseKind={baseKind}
            baseRef={baseRef}
            headKind={headKind}
            headRef={headRef}
            branches={branches}
            tags={tags}
            defaultBranch={defaultBranch}
            onBaseChange={(kind, ref) => {
              setBaseKind(kind)
              setBaseRef(ref)
            }}
            onHeadChange={(kind, ref) => {
              setHeadKind(kind)
              setHeadRef(ref)
            }}
            onSwap={() => {
              setBaseKind(headKind)
              setBaseRef(headRef)
              setHeadKind(baseKind)
              setHeadRef(baseRef)
            }}
            onCompare={() => {
              setAppliedCompare({
                baseKind,
                baseRef,
                headKind,
                headRef,
              })
            }}
            compareEnabled={compareEnabled}
          />

          {compareFetching && (
            <p className="text-xs text-text-secondary">Refreshing comparison…</p>
          )}

          {!appliedCompare && (
            <p className="text-xs text-text-secondary">
              Select source and target, then press Compare.
            </p>
          )}

          {effectiveCompare && <CompareSummaryStats compare={effectiveCompare} />}
        </div>
      </div>

      {!appliedCompare ? (
        <div className="app-panel">
          <div className="app-panel-body">
            <EmptyState
              icon={<GitCompare size={40} />}
              title="Ready to compare"
              description="Select source and target revisions, then press Compare."
            />
          </div>
        </div>
      ) : (
        <>
          <RepoDetailTabs
            tabs={[
              {
                id: 'changes',
                label: effectiveCompare
                  ? `Changes (${effectiveCompare.files_changed})`
                  : 'Changes',
              },
              {
                id: 'commits',
                label: effectiveCompare
                  ? `Commits (${effectiveCompare.commits.length})`
                  : 'Commits',
              },
            ]}
            active={activeTab}
            onChange={(id) => setActiveTab(id as 'changes' | 'commits')}
          />

          <div className="app-panel">
            <div className="app-panel-body flush">
              {activeTab === 'commits' ? (
                compareLoading ? (
                  <div className="flex items-center gap-2 text-text-secondary text-sm p-4">
                    <Loader2 size={16} className="animate-spin" />
                    Loading commits…
                  </div>
                ) : (
                  <div className="p-4">
                    <CompareCommitList
                      commits={effectiveCompare?.commits ?? []}
                      orgSlug={orgSlug}
                      repoSlug={repoSlug}
                    />
                  </div>
                )
              ) : compareLoading ? (
                <CompareDiffPanel loading />
              ) : (
                <CompareDiffPanel
                  diff={effectiveCompare?.diff}
                  error={compareError ? (compareError as Error).message : null}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
