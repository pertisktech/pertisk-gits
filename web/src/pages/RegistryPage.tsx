import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ContainerImageSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { useRegistryImageParam } from '../hooks/useRegistryImageParam'
import {
  EmptyState,
  LinkButton,
  PrimaryButton,
  SecondaryButton,
  Select,
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

export function RegistryPage() {
  const orgPath = useOrgPathParam()
  const imageName = useRegistryImageParam()
  const navigate = useNavigate()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const decodedImage = imageName

  const { data: images = [], isLoading: listLoading } = useQuery({
    queryKey: ['registry-images', orgPath],
    queryFn: () => api.listContainerImages(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const {
    items: pageImages,
    page,
    setPage,
    pageSize,
    total: imageTotal,
  } = useClientPagination(images)

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['registry-image', orgPath, decodedImage],
    queryFn: () => api.getContainerImage(token!, orgPath, decodedImage!),
    enabled: Boolean(token && orgPath && decodedImage),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['repositories', orgPath],
    queryFn: () => api.listRepositories(token!, orgPath),
    enabled: Boolean(token && orgPath && decodedImage),
  })

  const deleteImage = useMutation({
    mutationFn: (name: string) => api.deleteContainerImage(token!, orgPath, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-images', orgPath] })
      setError(null)
      if (decodedImage) navigate(`/groups/${orgPath}/registry`)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteTag = useMutation({
    mutationFn: (tag: string) => api.deleteContainerTag(token!, orgPath, decodedImage!, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', orgPath, decodedImage] })
      queryClient.invalidateQueries({ queryKey: ['registry-images', orgPath] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const runGc = useMutation({
    mutationFn: () => api.runRegistryGc(token!, orgPath),
    onSuccess: (report) => {
      setError(null)
      alert(
        `GC complete: ${report.blobs_removed} blob(s) removed, ${report.upload_files_removed} stale upload(s) cleaned.`,
      )
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateImage = useMutation({
    mutationFn: (payload: { description?: string; linked_repository_id?: string | null }) =>
      api.updateContainerImage(token!, orgPath, decodedImage!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', orgPath, decodedImage] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const registryBase = `/groups/${orgPath}/registry`

  return (
    <>
      <div className="app-repo-header mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="app-repo-title">
            <span>{decodedImage ?? 'Container registry'}</span>
          </h1>
          <p className="app-repo-desc">
            OCI images for @{orgPath} — push with docker login &amp;&amp; docker push host/{orgPath}/image:tag
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <SecondaryButton
            type="button"
            disabled={runGc.isPending}
            onClick={() => runGc.mutate()}
          >
            {runGc.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Run GC
          </SecondaryButton>
          {decodedImage && (
            <LinkButton to={registryBase}>All images</LinkButton>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      {!decodedImage && (
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
              description={`Push an image to ${orgPath}/my-app:tag after docker login.`}
            />
          )}

          {!listLoading && images.length > 0 && (
            <table className="app-list-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Tags</th>
                  <th>Linked repo</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageImages.map((image: ContainerImageSummary) => (
                  <tr key={image.id}>
                    <td>
                      <Link
                        to={`${registryBase}/${encodeURIComponent(image.name)}`}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {orgPath}/{image.name}
                      </Link>
                      {image.description && (
                        <div className="text-xs text-text-secondary mt-0.5">{image.description}</div>
                      )}
                    </td>
                    <td className="font-mono text-sm">{image.tag_count}</td>
                    <td className="font-mono text-sm text-text-secondary">
                      {image.linked_repository_slug ?? '—'}
                    </td>
                    <td className="text-sm text-text-secondary">
                      {new Date(image.updated_at).toLocaleString()}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-dashboard-danger hover:underline text-xs"
                        disabled={deleteImage.isPending}
                        onClick={() => {
                          if (confirm(`Delete image ${image.name} and all tags?`)) {
                            deleteImage.mutate(image.name)
                          }
                        }}
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
      )}

      {decodedImage && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Link to={registryBase} className="text-sm text-primary hover:underline">
              ← All images
            </Link>
            <span className="font-mono text-sm text-text">{orgPath}/{decodedImage}</span>
          </div>

          {detailLoading && (
            <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
          )}

          {detail && (
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
                    <Select
                      id="registry-linked-repo"
                      label="Linked git repository"
                      className="mono"
                      value={detail.linked_repository_id ?? ''}
                      onChange={(e) => {
                        const value = e.target.value || null
                        updateImage.mutate({ linked_repository_id: value })
                      }}
                    >
                      <option value="">— none —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.slug}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-text-secondary">
                      Tag commit links use this repository when a commit SHA is set on push.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pt-4 mt-4 border-t border-naturals-n4">
                  <PrimaryButton
                    type="button"
                    disabled={deleteImage.isPending}
                    onClick={() => {
                      if (confirm(`Delete ${decodedImage} and all tags?`)) {
                        deleteImage.mutate(decodedImage)
                      }
                    }}
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
                          <td className="font-mono text-xs">
                            {tag.commit_sha ? (
                              detail.linked_repository_slug ? (
                                <Link
                                  to={`/groups/${orgPath}/projects/${detail.linked_repository_slug}/commit/${tag.commit_sha}`}
                                  className="text-primary hover:underline"
                                >
                                  {tag.commit_sha.slice(0, 7)}
                                </Link>
                              ) : (
                                tag.commit_sha.slice(0, 7)
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="text-sm">{formatBytes(tag.size_bytes)}</td>
                          <td className="text-sm text-text-secondary">
                            {new Date(tag.updated_at).toLocaleString()}
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              className="text-dashboard-danger hover:underline text-xs"
                              disabled={deleteTag.isPending}
                              onClick={() => {
                                if (confirm(`Delete tag ${tag.name}?`)) {
                                  deleteTag.mutate(tag.name)
                                }
                              }}
                            >
                              Delete
                            </button>
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
      )}
    </>
  )
}
