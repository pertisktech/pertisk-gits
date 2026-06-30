import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { LinkButton, PrimaryButton, Select } from '../components/ui'
import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { findGroupByPath } from '../lib/groupPath'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function NewProjectPage() {
  const orgPath = useOrgPathParam()
  const { token } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = findGroupByPath(groups, orgPath)

  const createProject = useMutation({
    mutationFn: () =>
      api.createRepository(token!, orgPath, {
        name,
        slug: projectSlug,
        description: description || undefined,
        visibility,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['repositories', orgPath] })
      navigate(`/groups/${orgPath}/projects/${project.slug}`)
    },
  })

  function onNameChange(value: string) {
    setName(value)
    if (!slugTouched) setProjectSlug(slugify(value))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    createProject.mutate()
  }

  return (
    <>
      <div className="app-repo-header mb-4">
        <h1 className="app-repo-title">
          <span>New repository</span>
        </h1>
        <p className="app-repo-desc">
          Create a repository under {group?.name ?? orgPath}.
        </p>
      </div>

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {createProject.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {(createProject.error as Error).message}
            </div>
          )}
          <label className="block text-sm font-semibold text-text">
            Project name
            <input className={`${fieldClass} mt-1.5`} value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </label>
          <label className="block text-sm font-semibold text-text">
            Project slug
            <input
              className={`${fieldClass} mt-1.5 font-mono`}
              value={projectSlug}
              onChange={(e) => {
                setSlugTouched(true)
                setProjectSlug(e.target.value)
              }}
              required
            />
            <span className="text-xs text-text-secondary mt-1 block font-mono">
              {orgPath}/{projectSlug || 'project-slug'}
            </span>
          </label>
          <Select
            label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
          >
            <option value="private">Private — only group members</option>
            <option value="public">Public — anyone can read</option>
          </Select>
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
            <PrimaryButton type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </PrimaryButton>
            <LinkButton to={`/groups/${orgPath}`}>Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </>
  )
}
