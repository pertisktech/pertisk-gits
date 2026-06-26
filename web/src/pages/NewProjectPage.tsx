import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Alert, Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'
import { FieldLabel, Input, Select, Textarea } from '../components/ui/Input'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function NewProjectPage() {
  const { slug: orgSlug = '' } = useParams()
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
  const group = groups.find((g) => g.slug === orgSlug)

  const createProject = useMutation({
    mutationFn: () =>
      api.createRepository(token!, orgSlug, {
        name,
        slug: projectSlug,
        description: description || undefined,
        visibility,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['repositories', orgSlug] })
      navigate(`/groups/${orgSlug}/projects/${project.slug}`)
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
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? orgSlug, to: `/groups/${orgSlug}` },
          { label: 'New repository' },
        ]}
      />
      <PageHeader
        title="New repository"
        subtitle={`Create a repository under ${group?.name ?? orgSlug}.`}
      />

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {createProject.error && <Alert>{(createProject.error as Error).message}</Alert>}
          <FieldLabel label="Project name">
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </FieldLabel>
          <FieldLabel label="Project slug">
            <Input
              className="font-mono"
              value={projectSlug}
              onChange={(e) => {
                setSlugTouched(true)
                setProjectSlug(e.target.value)
              }}
              required
            />
            <span className="mt-1 block font-mono text-theme-xs text-gray-500 dark:text-gray-400">
              {orgSlug}/{projectSlug || 'project-slug'}
            </span>
          </FieldLabel>
          <FieldLabel label="Visibility">
            <Select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="private">Private — only group members</option>
              <option value="public">Public — anyone can read</option>
            </Select>
          </FieldLabel>
          <FieldLabel label="Description (optional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FieldLabel>
          <div className="flex gap-2 pt-2">
            <PrimaryButton type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </PrimaryButton>
            <LinkButton to={`/groups/${orgSlug}`}>Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </>
  )
}
