export type GroupSettingsSection = 'general' | 'automation'

export const GROUP_SETTINGS_SECTIONS: {
  id: GroupSettingsSection
  label: string
}[] = [
  { id: 'general', label: 'General' },
  { id: 'automation', label: 'Automation' },
]

export function parseGroupSettingsSection(value: string | null): GroupSettingsSection {
  if (value && GROUP_SETTINGS_SECTIONS.some((section) => section.id === value)) {
    return value as GroupSettingsSection
  }
  return 'general'
}

export function groupSettingsSectionHref(basePath: string, section: GroupSettingsSection) {
  return `${basePath}/settings?section=${section}`
}
