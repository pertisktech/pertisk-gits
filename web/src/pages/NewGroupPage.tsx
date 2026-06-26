import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Alert, Breadcrumbs, LinkButton, PageHeader, PrimaryButton } from '../components/ui'
import { FieldLabel, Input, Textarea } from '../components/ui/Input'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

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
          {createGroup.error && <Alert>{(createGroup.error as Error).message}</Alert>}
          <FieldLabel label="Group name">
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </FieldLabel>
          <FieldLabel label="Group URL">
            <Input
              className="font-mono"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              required
            />
            <span className="mt-1 block font-mono text-theme-xs text-gray-500 dark:text-gray-400">
              pertisk-gits/{slug || 'your-group'}
            </span>
          </FieldLabel>
          <FieldLabel label="Description (optional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FieldLabel>
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
