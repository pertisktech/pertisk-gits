import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ContainerImageSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { GroupSubnav } from '../components/GroupNav'
import {
  Breadcrumbs,
  EmptyState,
  LinkButton,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function shortDigest(digest: string): string {
  return digest.length > 19 ? `${digest.slice(0, 19)}…` : digest
}

export function RegistryPage() {
  const { slug = '', imageName } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const decodedImage = imageName ? decodeURIComponent(imageName) : null

  const { data: images = [], isLoading: listLoading } = useQuery({
    queryKey: ['registry-images', slug],
    queryFn: () => api.listContainerImages(token!, slug),
    enabled: Boolean(token && slug),
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['registry-image', slug, decodedImage],
    queryFn: () => api.getContainerImage(token!, slug, decodedImage!),
    enabled: Boolean(token && slug && decodedImage),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['repositories', slug],
    queryFn: () => api.listRepositories(token!, slug),
    enabled: Boolean(token && slug && decodedImage),
  })

  const deleteImage = useMutation({
    mutationFn: (name: string) => api.deleteContainerImage(token!, slug, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-images', slug] })
      setError(null)
      if (decodedImage) navigate(`/groups/${slug}/registry`)
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteTag = useMutation({
    mutationFn: (tag: string) => api.deleteContainerTag(token!, slug, decodedImage!, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', slug, decodedImage] })
      queryClient.invalidateQueries({ queryKey: ['registry-images', slug] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const runGc = useMutation({
    mutationFn: () => api.runRegistryGc(token!, slug),
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
      api.updateContainerImage(token!, slug, decodedImage!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-image', slug, decodedImage] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const registryBase = `/groups/${slug}/registry`

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: slug, to: `/groups/${slug}` },
          { label: 'Registry', to: registryBase },
          ...(decodedImage ? [{ label: decodedImage }] : []),
        ]}
      />

      <PageHeader
        title="Container registry"
        subtitle={`OCI images for @${slug} — push with docker login && docker push host/${slug}/image:tag`}
        action={
          <div className="flex gap-2">
            <SecondaryButton
              type="button"
              disabled={runGc.isPending}
              onClick={() => runGc.mutate()}
            >
              {runGc.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Run GC
            </SecondaryButton>
            {!decodedImage && (
              <LinkButton to={`/groups/${slug}`}>Back to group</LinkButton>
            )}
          </div>
        }
      />

      <GroupSubnav orgSlug={slug} activeTab="registry" />

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {error}
        </div>
      )}

      {!decodedImage && (
        <div className="app-panel">
          <div className="app-panel-header flex items-center justify-between">
            <span>Images</span>
            <span className="font-normal text-text-secondary">{images.length}</span>
          </div>

          {listLoading && (
            <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
          )}

          {!listLoading && images.length === 0 && (
            <EmptyState
              icon={<Package size={40} />}
              title="No container images"
              description={`Push an image to ${slug}/my-app:tag after docker login.`}
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
                {images.map((image: ContainerImageSummary) => (
                  <tr key={image.id}>
                    <td>
                      <Link
                        to={`${registryBase}/${encodeURIComponent(image.name)}`}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {slug}/{image.name}
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
        </div>
      )}

      {decodedImage && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Link to={registryBase} className="text-sm text-primary hover:underline">
              ← All images
            </Link>
            <span className="font-mono text-sm text-text">{slug}/{decodedImage}</span>
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
                    <label htmlFor="registry-linked-repo" className="text-sm font-medium text-text">
                      Linked git repository
                    </label>
                    <select
                      id="registry-linked-repo"
                      className="app-field mono"
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
                    </select>
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
                                  to={`/groups/${slug}/projects/${detail.linked_repository_slug}/commit/${tag.commit_sha}`}
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
