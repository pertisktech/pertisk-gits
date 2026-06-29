import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'
import { groupBaseUrl } from '../lib/groupPath'
import { groupBreadcrumbItems } from '../lib/groupRoute'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function NewGroupPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const parentPath = searchParams.get('parent')?.trim() || undefined
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')

  const fullPathPreview = parentPath ? `${parentPath}/${slug || 'subgroup'}` : slug || 'your-group'

  const createGroup = useMutation({
    mutationFn: () =>
      api.createOrganization(token!, {
        name,
        slug,
        description: description || undefined,
        parent_path: parentPath,
      }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      if (parentPath) {
        queryClient.invalidateQueries({ queryKey: ['subgroups', parentPath] })
      }
      navigate(groupBaseUrl(group))
    },
  })

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    createGroup.mutate()
  }

  const breadcrumbItems = parentPath
    ? [...groupBreadcrumbItems(parentPath), { label: 'New subgroup' }]
    : [{ label: 'Groups', to: '/groups' }, { label: 'New group' }]

  return (
    <>
      <Breadcrumbs items={breadcrumbItems} />
      <PageHeader
        title={parentPath ? 'New subgroup' : 'New group'}
        subtitle={
          parentPath
            ? `Creates a subgroup under ${parentPath}.`
            : 'A group contains subgroups and repositories (like GitLab).'
        }
      />

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {createGroup.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {(createGroup.error as Error).message}
            </div>
          )}
          {parentPath && (
            <p className="text-sm text-text-secondary">
              Parent group: <span className="font-mono text-text">{parentPath}</span>
            </p>
          )}
          <label className="block text-sm font-semibold text-text">
            Group name
            <input className={`${fieldClass} mt-1.5`} value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </label>
          <label className="block text-sm font-semibold text-text">
            URL segment
            <input
              className={`${fieldClass} mt-1.5 font-mono`}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              required
            />
            <span className="text-xs text-text-secondary mt-1 block font-mono">pertisk-gits/{fullPathPreview}</span>
          </label>
          <label className="block text-sm font-semibold text-text">
            Description (optional)
            <textarea
              className={`${fieldClass} mt-1.5`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <div className="flex gap-2 pt-2">
            <PrimaryButton type="submit" disabled={createGroup.isPending}>
              {createGroup.isPending ? 'Creating…' : parentPath ? 'Create subgroup' : 'Create group'}
            </PrimaryButton>
            <LinkButton to={parentPath ? `/groups/${parentPath}` : '/groups'}>Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </>
  )
}
