import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

export function NewGroupPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')

  const createGroup = useMutation({
    mutationFn: () =>
      api.createOrganization(token!, {
        name,
        slug,
        description: description || undefined,
      }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      navigate(`/groups/${group.slug}`)
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

  return (
    <>
      <Breadcrumbs items={[{ label: 'Groups', to: '/groups' }, { label: 'New group' }]} />
      <PageHeader title="New group" subtitle="A group contains one or more projects (repositories)." />

      <Card className="max-w-xl">
        <form onSubmit={onSubmit} className="space-y-4">
          {createGroup.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {(createGroup.error as Error).message}
            </div>
          )}
          <label className="block text-sm font-semibold text-text">
            Group name
            <input className={`${fieldClass} mt-1.5`} value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </label>
          <label className="block text-sm font-semibold text-text">
            Group URL
            <input
              className={`${fieldClass} mt-1.5 font-mono`}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              required
            />
            <span className="text-xs text-text-secondary mt-1 block font-mono">pertisk-gits/{slug || 'your-group'}</span>
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
              {createGroup.isPending ? 'Creating…' : 'Create group'}
            </PrimaryButton>
            <LinkButton to="/groups">Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </>
  )
}
