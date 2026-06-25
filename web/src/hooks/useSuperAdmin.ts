import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function useSuperAdmin() {
  const { token, user } = useAuth()

  const { data } = useQuery({
    queryKey: ['me', token],
    queryFn: () => api.me(token!),
    enabled: Boolean(token),
    staleTime: 60_000,
  })

  return data?.is_super_admin ?? user?.is_super_admin ?? false
}
