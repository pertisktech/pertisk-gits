export type RepoSettingsSection = 'general' | 'access' | 'security' | 'automation'

export const REPO_SETTINGS_SECTIONS: {
  id: RepoSettingsSection
  label: string
}[] = [
  { id: 'general', label: 'General' },
  { id: 'access', label: 'Access' },
  { id: 'security', label: 'Security' },
  { id: 'automation', label: 'Automation' },
]

export function parseRepoSettingsSection(value: string | null): RepoSettingsSection {
  if (value && REPO_SETTINGS_SECTIONS.some((section) => section.id === value)) {
    return value as RepoSettingsSection
  }
  return 'general'
}

export function repoSettingsSectionHref(basePath: string, section: RepoSettingsSection) {
  return `${basePath}/settings?section=${section}`
}
