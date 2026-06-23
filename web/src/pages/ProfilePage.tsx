import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { Breadcrumbs, PageHeader } from '../components/ui'

export function ProfilePage() {
  const { token, user } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(token!),
    enabled: Boolean(token),
  })

  const profile = data?.user ?? user

  return (
    <>
      <Breadcrumbs items={[{ label: 'Profile' }]} />
      <PageHeader title="User profile" subtitle="Account information and preferences" />

      <Card className="max-w-lg">
        {isLoading && <div className="text-text-secondary">Loading profile…</div>}
        {profile && (
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-text-secondary font-medium">Username</dt>
              <dd className="text-text mt-0.5 font-mono">@{profile.username}</dd>
            </div>
            <div>
              <dt className="text-text-secondary font-medium">Email</dt>
              <dd className="text-text mt-0.5">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-text-secondary font-medium">Display name</dt>
              <dd className="text-text mt-0.5">{profile.display_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-secondary font-medium">Member since</dt>
              <dd className="text-text mt-0.5">{new Date(profile.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>
        )}
      </Card>
    </>
  )
}
