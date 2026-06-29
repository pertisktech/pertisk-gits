import { useMemo } from 'react'
import type { Organization } from '../api/types'
import { useGroupStats } from './useGroupStats'

export function useTopLevelGroupStats(groups: Organization[]) {
  const topLevelGroups = useMemo(
    () => groups.filter((group) => !group.parent_id),
    [groups],
  )

  const { statsByGroupId, isLoading } = useGroupStats(topLevelGroups, groups)

  return { topLevelGroups, statsByGroupId, isLoading }
}
