import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ContainerImageSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import {
  Alert,
  Breadcrumbs,
  EmptyState,
  LinkButton,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui'
import { FieldLabel, Input, Select } from '../components/ui/Input'

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

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === slug)

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
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug, to: `/groups/${slug}` },
          { label: 'Registry', to: decodedImage ? registryBase : undefined },
          ...(decodedImage ? [{ label: decodedImage }] : []),
        ]}
      />
      <PageHeader
        title={decodedImage ?? 'Container registry'}
        subtitle={`OCI images for @${slug} — push with docker login && docker push host/${slug}/image:tag`}
        action={
          <div className="flex shrink-0 gap-2">
            <SecondaryButton
              type="button"
              disabled={runGc.isPending}
              onClick={() => runGc.mutate()}
              startIcon={runGc.isPending ? <Loader2 size={14} className="animate-spin" /> : undefined}
            >
              Run GC
            </SecondaryButton>
            {decodedImage && <LinkButton to={registryBase}>All images</LinkButton>}
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}

      {!decodedImage && (
        <div className="shell-card">
          <div className="shell-card-header">
            <span>Images</span>
            <span className="font-normal text-gray-500 dark:text-gray-400">{images.length}</span>
          </div>

          {listLoading && (
            <div className="shell-card-body py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
              Loading…
            </div>
          )}

          {!listLoading && images.length === 0 && (
            <EmptyState
              icon={<Package size={40} />}
              title="No container images"
              description={`Push an image to ${slug}/my-app:tag after docker login.`}
            />
          )}

          {!listLoading && images.length > 0 && (
            <div className="overflow-x-auto">
              <table className="shell-table w-full">
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
                          className="font-mono text-theme-sm text-brand-500 hover:underline dark:text-brand-400"
                        >
                          {slug}/{image.name}
                        </Link>
                        {image.description && (
                          <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                            {image.description}
                          </div>
                        )}
                      </td>
                      <td className="font-mono text-theme-sm">{image.tag_count}</td>
                      <td className="font-mono text-theme-sm text-gray-500 dark:text-gray-400">
                        {image.linked_repository_slug ?? '—'}
                      </td>
                      <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                        {new Date(image.updated_at).toLocaleString()}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-theme-xs text-error-500 hover:underline"
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
            </div>
          )}
        </div>
      )}

      {decodedImage && (
        <div className="space-y-4">
          {detailLoading && (
            <div className="py-8 text-center text-theme-sm text-gray-500 dark:text-gray-400">Loading…</div>
          )}

          {detail && (
            <>
              <div className="shell-card max-w-xl">
                <div className="shell-card-header">Metadata</div>
                <div className="shell-card-body space-y-4">
                  <FieldLabel label="Description">
                    <Input
                      id="registry-image-description"
                      defaultValue={detail.description ?? ''}
                      placeholder="Optional description"
                      onBlur={(e) => {
                        const value = e.target.value.trim()
                        if (value !== (detail.description ?? '')) {
                          updateImage.mutate({ description: value })
                        }
                      }}
                    />
                  </FieldLabel>
                  <FieldLabel
                    label="Linked git repository"
                    hint="Tag commit links use this repository when a commit SHA is set on push."
                  >
                    <Select
                      id="registry-linked-repo"
                      className="font-mono"
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
                  </FieldLabel>
                  <div className="flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
                    <PrimaryButton
                      type="button"
                      disabled={deleteImage.isPending}
                      startIcon={<Trash2 size={14} />}
                      onClick={() => {
                        if (confirm(`Delete ${decodedImage} and all tags?`)) {
                          deleteImage.mutate(decodedImage)
                        }
                      }}
                    >
                      Delete image
                    </PrimaryButton>
                  </div>
                </div>
              </div>

              <div className="shell-card">
                <div className="shell-card-header">
                  <span>Tags</span>
                  <span className="font-normal text-gray-500 dark:text-gray-400">{detail.tags.length}</span>
                </div>
                {detail.tags.length === 0 ? (
                  <div className="shell-card-body text-theme-sm text-gray-500 dark:text-gray-400">
                    No tags pushed yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="shell-table w-full">
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
                            <td className="font-mono text-theme-sm">{tag.name}</td>
                            <td className="font-mono text-theme-xs text-gray-500 dark:text-gray-400" title={tag.manifest_digest}>
                              {shortDigest(tag.manifest_digest)}
                            </td>
                            <td className="font-mono text-theme-xs">
                              {tag.commit_sha ? (
                                detail.linked_repository_slug ? (
                                  <Link
                                    to={`/groups/${slug}/projects/${detail.linked_repository_slug}/commit/${tag.commit_sha}`}
                                    className="text-brand-500 hover:underline dark:text-brand-400"
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
                            <td className="text-theme-sm">{formatBytes(tag.size_bytes)}</td>
                            <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                              {new Date(tag.updated_at).toLocaleString()}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="text-theme-xs text-error-500 hover:underline"
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
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
