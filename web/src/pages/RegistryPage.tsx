import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, DatabaseZap, GitBranch, Loader2, Package, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ContainerImageSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { CopyField } from '../components/RepoClonePushGuide'
import { useProjectParams } from '../hooks/useProjectParams'
import { useRegistryImageParam } from '../hooks/useRegistryImageParam'
import {
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  TablePagination,
} from '../components/ui'
import { useClientPagination } from '../lib/pagination'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function shortDigest(digest: string): string {
  return digest.length > 19 ? `${digest.slice(0, 19)}…` : digest
}

function buildRegistryImagePath(orgPath: string, repoSlug: string, imageName?: string | null): string {
  const base = `${orgPath}/${repoSlug}`
  const raw = (imageName ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!raw) return base
  if (raw === repoSlug) return base
  if (raw === base) return base
  if (raw.startsWith(`${base}/`)) return raw
  if (raw.startsWith(`${orgPath}/`)) return raw
  return `${base}/${raw}`
}

export function RegistryPage() {
  const { orgSlug: orgPath, projectSlug: repoSlug } = useProjectParams()
  const imageName = useRegistryImageParam()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [gcMessage, setGcMessage] = useState<string | null>(null)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(imageName)
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'image'; imageName: string } | { kind: 'tag'; imageName: string; tagName: string } | null
  >(null)
  const commandsRef = useRef<HTMLDivElement>(null)
  const registryHost = typeof window !== 'undefined' ? window.location.host : 'registry.local'
  const currentUsername = user?.username?.trim() || 'CURRENT_USERNAME'
  const imageNameForCommand = selectedImage || imageName || null
  const imagePath = buildRegistryImagePath(orgPath, repoSlug, imageNameForCommand)
  const imageRef = `${imagePath}:latest`
  const loginCommand = `docker login ${registryHost} -u ${currentUsername}`
  const pushCommand = `docker push ${registryHost}/${imageRef}`
  const pullCommand = `docker pull ${registryHost}/${imageRef}`

  const { data: images = [], isLoading: listLoading } = useQuery({
    queryKey: ['registry-images', orgPath, repoSlug],
    queryFn: () => api.listContainerImages(token!, orgPath, repoSlug),
    enabled: Boolean(token && orgPath && repoSlug),
  })

  const {
    items: pageImages,
    page,
    setPage,
    pageSize,
    total: imageTotal,
  } = useClientPagination(images)

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['registry-image', orgPath, repoSlug, selectedImage],
    queryFn: () => api.getContainerImage(token!, orgPath, repoSlug, selectedImage!),
    enabled: Boolean(token && orgPath && repoSlug && selectedImage),
  })

  const deleteImage = useMutation({
    mutationFn: (name: string) => api.deleteContainerImage(token!, orgPath, repoSlug, name),
    onSuccess: (_value, name) => {
      queryClient.invalidateQueries({ queryKey: ['registry-images', orgPath, repoSlug] })
      setError(null)
      if (selectedImage === name) {
        setSelectedImage(null)
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteTag = useMutation({
    mutationFn: (payload: { imageName: string; tag: string }) =>
      api.deleteContainerTag(token!, orgPath, repoSlug, payload.imageName, payload.tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', orgPath, repoSlug, selectedImage] })
      queryClient.invalidateQueries({ queryKey: ['registry-images', orgPath, repoSlug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const runGc = useMutation({
    mutationFn: () => api.runRegistryGc(token!, orgPath, repoSlug),
    onSuccess: (report) => {
      setError(null)
      setGcMessage(
        `Garbage collection complete: ${report.blobs_removed} blob(s) removed, ${report.upload_files_removed} stale upload file(s) cleaned.`,
      )
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateImage = useMutation({
    mutationFn: (payload: { description?: string }) =>
      api.updateContainerImage(token!, orgPath, repoSlug, selectedImage!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', orgPath, repoSlug, selectedImage] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (commandsRef.current && !commandsRef.current.contains(event.target as Node)) {
        setCommandsOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (imageName) {
      setSelectedImage(imageName)
    }
  }, [imageName])

  useEffect(() => {
    if (!selectedImage && images.length > 0) {
      setSelectedImage(images[0].name)
    }
  }, [images, selectedImage])

  return (
    <>
      <div className="app-repo-header mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="app-repo-title">
            <span>Container registry</span>
          </h1>
          <p className="app-repo-desc">
            OCI images for {orgPath}/{repoSlug} — push with docker login &amp;&amp; docker push host/{orgPath}/{repoSlug}:tag
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="app-clone-dropdown" ref={commandsRef}>
            <PrimaryButton
              type="button"
              aria-expanded={commandsOpen}
              aria-haspopup="dialog"
              onClick={() => setCommandsOpen((v) => !v)}
            >
              <GitBranch size={15} />
              Registry
              <ChevronDown size={14} className={`transition-transform ${commandsOpen ? 'rotate-180' : ''}`} />
            </PrimaryButton>
            {commandsOpen && (
              <div className="app-code-dropdown">
                <div className="app-code-dropdown-body space-y-3">
                  <CopyField label="Login command" value={loginCommand} />
                  <CopyField label="Push command" value={pushCommand} />
                  <CopyField label="Pull command" value={pullCommand} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="app-panel p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <DatabaseZap size={18} className="text-primary mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-text">Registry Maintenance</h2>
              <p className="text-xs text-text-secondary mt-1">
                Run garbage collection to remove unreferenced blobs and stale uploads.
              </p>
            </div>
          </div>
          <SecondaryButton
            type="button"
            disabled={runGc.isPending}
            onClick={() => {
              setGcMessage(null)
              runGc.mutate()
            }}
          >
            {runGc.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            {runGc.isPending ? 'Running GC…' : 'Run GC'}
          </SecondaryButton>
        </div>
        {gcMessage && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-green-g1/40 bg-green-g2/20 px-3 py-2 text-xs text-green-g1">
            <CheckCircle2 size={14} />
            <span>{gcMessage}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      <div className="app-panel">
          <div className="app-panel-header flex items-center justify-between">
            <span>Images</span>
            <span className="font-normal text-text-secondary">{imageTotal}</span>
          </div>

          {listLoading && (
            <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
          )}

          {!listLoading && images.length === 0 && (
            <EmptyState
              icon={<Package size={40} />}
              title="No container images"
              description={`Push an image to ${imagePath}:latest after docker login.`}
            />
          )}

          {!listLoading && images.length > 0 && (
            <table className="app-list-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Arch</th>
                  <th>Tags</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageImages.map((image: ContainerImageSummary) => (
                  <tr key={image.id}>
                    <td>
                      <button
                        type="button"
                        className="font-mono text-sm text-primary hover:underline"
                        onClick={() => setSelectedImage(image.name)}
                      >
                        {buildRegistryImagePath(orgPath, repoSlug, image.name)}
                      </button>
                      {image.description && (
                        <div className="text-xs text-text-secondary mt-0.5">{image.description}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          image.has_multi_arch
                            ? 'bg-green-g2/25 text-green-g1 border border-green-g1/30'
                            : 'bg-naturals-n3 text-text-secondary border border-naturals-n4'
                        }`}
                      >
                        {image.has_multi_arch ? 'multi-arch' : 'single-arch'}
                      </span>
                    </td>
                    <td className="font-mono text-sm">{image.tag_count}</td>
                    <td className="text-sm text-text-secondary">
                      {new Date(image.updated_at).toLocaleString()}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-dashboard-danger hover:underline text-xs"
                        disabled={deleteImage.isPending}
                        onClick={() => setPendingDelete({ kind: 'image', imageName: image.name })}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!listLoading && imageTotal > 0 && (
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={imageTotal}
              onPageChange={setPage}
              itemLabel="images"
            />
          )}
      </div>

      <div className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-text">
              {buildRegistryImagePath(orgPath, repoSlug, selectedImage)}
            </span>
          </div>

          {detailLoading && (
            <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
          )}

          {detail && selectedImage && (
            <>
              <div className="app-panel p-4 max-w-xl">
                <h2 className="text-sm font-semibold text-text mb-4">Metadata</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="registry-image-description" className="text-sm font-medium text-text">
                      Description
                    </label>
                    <input
                      id="registry-image-description"
                      className="app-field"
                      defaultValue={detail.description ?? ''}
                      placeholder="Optional description"
                      onBlur={(e) => {
                        const value = e.target.value.trim()
                        if (value !== (detail.description ?? '')) {
                          updateImage.mutate({ description: value })
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text">Image Path</label>
                    <div className="text-sm font-mono text-text-secondary">
                      {buildRegistryImagePath(orgPath, repoSlug, selectedImage)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-4 mt-4 border-t border-naturals-n4">
                  <PrimaryButton
                    type="button"
                    disabled={deleteImage.isPending}
                    onClick={() => setPendingDelete({ kind: 'image', imageName: selectedImage })}
                  >
                    <Trash2 size={14} />
                    Delete image
                  </PrimaryButton>
                </div>
              </div>

              <div className="app-panel">
                <div className="app-panel-header flex items-center justify-between">
                  <span>Tags</span>
                  <span className="font-normal text-text-secondary">{detail.tags.length}</span>
                </div>
                {detail.tags.length === 0 ? (
                  <div className="p-6 text-sm text-text-secondary">No tags pushed yet.</div>
                ) : (
                  <table className="app-list-table">
                    <thead>
                      <tr>
                        <th>Tag</th>
                        <th>Digest</th>
                        <th>Platforms</th>
                        <th>Commit</th>
                        <th>Compressed size</th>
                        <th>Updated</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.tags.map((tag) => (
                        <tr key={tag.name}>
                          <td className="font-mono text-sm">{tag.name}</td>
                          <td className="font-mono text-xs text-text-secondary" title={tag.manifest_digest}>
                            {shortDigest(tag.manifest_digest)}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {tag.platforms.length > 0 ? tag.platforms.join(', ') : 'single-arch'}
                          </td>
                          <td className="font-mono text-xs">
                            {tag.commit_sha ? (
                              <Link
                                to={`/groups/${orgPath}/projects/${repoSlug}/commit/${tag.commit_sha}`}
                                className="text-primary hover:underline"
                              >
                                {tag.commit_sha.slice(0, 7)}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="text-sm">{formatBytes(tag.size_bytes)}</td>
                          <td className="text-sm text-text-secondary">
                            {new Date(tag.updated_at).toLocaleString()}
                          </td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                type="button"
                                className="text-primary hover:underline text-xs"
                                onClick={async () => {
                                  const pull = `docker pull ${registryHost}/${buildRegistryImagePath(orgPath, repoSlug, selectedImage)}:${tag.name}`
                                  await navigator.clipboard.writeText(pull)
                                }}
                              >
                                Copy pull
                              </button>
                              <button
                                type="button"
                                className="text-dashboard-danger hover:underline text-xs"
                                disabled={deleteTag.isPending}
                                onClick={() =>
                                  setPendingDelete({ kind: 'tag', imageName: selectedImage, tagName: tag.name })
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-naturals-n4 bg-surface p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-text">Confirm delete</h3>
            <p className="mt-2 text-sm text-text-secondary">
              {pendingDelete.kind === 'image'
                ? `Delete image ${pendingDelete.imageName} and all tags?`
                : `Delete tag ${pendingDelete.tagName} from ${pendingDelete.imageName}?`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <SecondaryButton type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={() => {
                  if (pendingDelete.kind === 'image') {
                    deleteImage.mutate(pendingDelete.imageName)
                  } else {
                    deleteTag.mutate({ imageName: pendingDelete.imageName, tag: pendingDelete.tagName })
                  }
                  setPendingDelete(null)
                }}
              >
                Delete
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
