import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, History, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { WikiPageSummary } from '../api/types'
import { MarkdownBody, formatDateTime } from '../lib/collaboration'
import { wikiPagePath } from '../lib/projectRoute'
import { ConfirmModal } from './ConfirmModal'
import { EmptyState, PrimaryButton, SecondaryButton } from './ui'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function RepoWiki({
  token,
  orgSlug,
  repoSlug,
}: {
  token?: string | null
  orgSlug: string
  repoSlug: string
}) {
  const { pageSlug: pageSlugParam } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showNewPage, setShowNewPage] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['wiki-pages', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.listWikiPages(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const pages = listData?.pages ?? []
  const activeSlug = pageSlugParam ?? (pages.some((p) => p.slug === 'home') ? 'home' : pages[0]?.slug)

  const { data: pageData, isLoading: pageLoading, error } = useQuery({
    queryKey: ['wiki-page', orgSlug, repoSlug, activeSlug, token ?? 'public'],
    queryFn: () => api.getWikiPage(orgSlug, repoSlug, activeSlug!, token),
    enabled: Boolean(orgSlug && repoSlug && activeSlug),
  })

  const { data: revisionsData } = useQuery({
    queryKey: ['wiki-revisions', orgSlug, repoSlug, activeSlug, token ?? 'public'],
    queryFn: () => api.listWikiRevisions(orgSlug, repoSlug, activeSlug!, token),
    enabled: Boolean(orgSlug && repoSlug && activeSlug && showHistory),
  })

  useEffect(() => {
    if (!pageData || editing) return
    setDraftTitle(pageData.page.title)
    setDraftBody(pageData.page.body)
  }, [pageData, editing])

  const basePath = `/groups/${orgSlug}/projects/${repoSlug}/wiki`

  const sidebarPages = useMemo(() => sortWikiPages(pages), [pages])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateWikiPage(token!, orgSlug, repoSlug, activeSlug!, {
        title: draftTitle,
        body: draftBody,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wiki-page', orgSlug, repoSlug, activeSlug] })
      queryClient.invalidateQueries({ queryKey: ['wiki-pages', orgSlug, repoSlug] })
      queryClient.invalidateQueries({ queryKey: ['wiki-revisions', orgSlug, repoSlug, activeSlug] })
      setEditing(false)
    },
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createWikiPage(token!, orgSlug, repoSlug, {
        title: newTitle,
        body: newBody,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['wiki-pages', orgSlug, repoSlug] })
      setShowNewPage(false)
      setNewTitle('')
      setNewBody('')
      navigate(wikiPagePath(basePath, created.page.slug))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.deleteWikiPage(token!, orgSlug, repoSlug, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wiki-pages', orgSlug, repoSlug] })
      setDeleteTarget(null)
      navigate(basePath)
    },
  })

  if (listLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading wiki…
      </div>
    )
  }

  if (!pageSlugParam && pages.length > 0 && activeSlug) {
    return <Navigate to={wikiPagePath(basePath, activeSlug)} replace />
  }

  if (pages.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text">Wiki</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Project documentation with Markdown pages and revision history.
            </p>
          </div>
        </div>
        <div className="app-panel">
          {token ? (
            showNewPage ? (
              <div className="app-panel-body space-y-4 max-w-2xl">
                <h3 className="text-sm font-semibold text-text">Create first page</h3>
                <input
                  className={fieldClass}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Page title (e.g. Home)"
                />
                <textarea
                  className={`${fieldClass} min-h-48 font-mono`}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="# Welcome\n\nWrite your wiki content in Markdown."
                />
                <div className="flex gap-2">
                  <PrimaryButton
                    type="button"
                    disabled={!newTitle.trim() || createMutation.isPending}
                    onClick={() => createMutation.mutate()}
                  >
                    Create page
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={() => setShowNewPage(false)}>
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen size={40} />}
                title="Start your wiki"
                description="Create a Home page or add documentation for your project."
                action={
                  <PrimaryButton type="button" onClick={() => setShowNewPage(true)}>
                    <Plus size={14} />
                    New page
                  </PrimaryButton>
                }
              />
            )
          ) : (
            <EmptyState
              icon={<BookOpen size={40} />}
              title="No wiki pages yet"
              description="Sign in to create project documentation."
            />
          )}
        </div>
      </div>
    )
  }

  if (!activeSlug) {
    return null
  }

  if (pageLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading page…
      </div>
    )
  }

  if (error || !pageData) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error)?.message ?? 'Wiki page not found'}
      </div>
    )
  }

  const { page, author } = pageData

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">Wiki</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Markdown documentation with sidebar navigation and history.
          </p>
        </div>
        {token && (
          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={() => setShowNewPage((v) => !v)}>
              <Plus size={14} />
              New page
            </SecondaryButton>
          </div>
        )}
      </div>

      {showNewPage && token ? (
        <div className="app-panel app-panel-body space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-text">New wiki page</h3>
          <input
            className={fieldClass}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Page title"
          />
          <textarea
            className={`${fieldClass} min-h-40 font-mono`}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Markdown content"
          />
          <div className="flex gap-2">
            <PrimaryButton
              type="button"
              disabled={!newTitle.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create page
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => setShowNewPage(false)}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)] gap-4 items-start">
        <aside className="app-panel p-3 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted px-2 pb-2">Pages</p>
          {sidebarPages.map((item) => (
            <Link
              key={item.slug}
              to={wikiPagePath(basePath, item.slug)}
              className={`block px-2 py-1.5 rounded-md text-sm truncate ${
                item.slug === activeSlug
                  ? 'bg-hover text-primary font-medium'
                  : 'text-text-secondary hover:text-text hover:bg-hover'
              }`}
            >
              {item.title}
            </Link>
          ))}
        </aside>

        <div className="app-panel min-w-0">
          <div className="app-panel-body space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {editing ? (
                  <input
                    className={`${fieldClass} text-lg font-semibold`}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                ) : (
                  <h1 className="text-lg font-semibold text-text">{page.title}</h1>
                )}
                <p className="text-sm text-text-secondary mt-1">
                  last updated by {author.username} · {formatDateTime(page.updated_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {token ? (
                  editing ? (
                    <>
                      <PrimaryButton
                        type="button"
                        disabled={saveMutation.isPending || !draftTitle.trim()}
                        onClick={() => saveMutation.mutate()}
                      >
                        Save
                      </PrimaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => {
                          setEditing(false)
                          setDraftTitle(page.title)
                          setDraftBody(page.body)
                        }}
                      >
                        Cancel
                      </SecondaryButton>
                    </>
                  ) : (
                    <>
                      <SecondaryButton type="button" onClick={() => setEditing(true)}>
                        Edit
                      </SecondaryButton>
                      <SecondaryButton type="button" onClick={() => setShowHistory((v) => !v)}>
                        <History size={14} />
                        History
                      </SecondaryButton>
                      <SecondaryButton type="button" onClick={() => setDeleteTarget(page.slug)}>
                        <Trash2 size={14} />
                        Delete
                      </SecondaryButton>
                    </>
                  )
                ) : null}
              </div>
            </div>

            {showHistory ? (
              <div className="border border-naturals-n4 rounded-lg p-3 space-y-2">
                <h3 className="text-sm font-semibold text-text">Revision history</h3>
                {(revisionsData?.revisions ?? []).length === 0 ? (
                  <p className="text-sm text-text-secondary">No revisions yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {(revisionsData?.revisions ?? []).map((revision) => (
                      <li
                        key={revision.id}
                        className="text-sm text-text-secondary flex flex-wrap gap-x-2 gap-y-1"
                      >
                        <span className="text-text">{revision.title}</span>
                        <span>·</span>
                        <span>{revision.author.username}</span>
                        <span>·</span>
                        <span>{formatDateTime(revision.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {editing ? (
              <textarea
                className={`${fieldClass} min-h-[24rem] font-mono`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
              />
            ) : (
              <div className="prose prose-invert max-w-none text-sm">
                {page.body.trim() ? (
                  <MarkdownBody content={page.body} orgSlug={orgSlug} repoSlug={repoSlug} />
                ) : (
                  <p className="text-text-secondary italic">This page is empty.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete wiki page"
        description="This removes the page and its revision history. This cannot be undone."
        confirmLabel="Delete page"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function sortWikiPages(pages: WikiPageSummary[]) {
  return [...pages].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.title.localeCompare(b.title)
  })
}
